import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.ts';
import { getDb } from './database.ts';
import { adminAuth } from './firebaseAdmin.ts';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: string;
  firebaseUid: string | null;
}

export interface AuthRequest extends Request {
  authUser?: AuthUser;
  requestId?: string;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function validatePasswordStrength(password: string): { valid: boolean; reason?: string } {
  if (typeof password !== 'string' || password.length < 8) {
    return { valid: false, reason: 'Password must be at least 8 characters long.' };
  }
  if (password.length > 128) {
    return { valid: false, reason: 'Password must not exceed 128 characters.' };
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return {
      valid: false,
      reason: 'Password must include at least one uppercase letter, one lowercase letter, and one number.',
    };
  }
  return { valid: true };
}

function base64UrlEncode(data: string | Buffer): string {
  return Buffer.from(data)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

export interface SessionTokenPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

export function signSessionToken(userId: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: userId,
      email,
      iat: now,
      exp: now + config.sessionTtlSeconds,
    } satisfies SessionTokenPayload)
  );
  const sig = base64UrlEncode(
    crypto.createHmac('sha256', config.sessionSecret).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${sig}`;
}

export function verifySessionToken(token: string): SessionTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const expectedSig = base64UrlEncode(
      crypto.createHmac('sha256', config.sessionSecret).update(`${header}.${payload}`).digest()
    );
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const decoded = JSON.parse(base64UrlDecode(payload)) as SessionTokenPayload;
    if (!decoded.sub || !decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function signFileAccessToken(fileId: string, userId: string, ttlSeconds = 300): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const data = `${fileId}:${userId}:${exp}`;
  const sig = base64UrlEncode(
    crypto.createHmac('sha256', config.sessionSecret).update(data).digest()
  );
  return `${exp}.${sig}`;
}

export function verifyFileAccessToken(token: string, fileId: string, ownerUserId: string): boolean {
  try {
    const [expStr, sig] = token.split('.');
    const exp = Number(expStr);
    if (!exp || exp < Math.floor(Date.now() / 1000)) return false;
    const data = `${fileId}:${ownerUserId}:${exp}`;
    const expectedSig = base64UrlEncode(
      crypto.createHmac('sha256', config.sessionSecret).update(data).digest()
    );
    const sigBuf = Buffer.from(sig || '');
    const expBuf = Buffer.from(expectedSig);
    return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

export async function resolveAuthUser(token: string): Promise<AuthUser | null> {
  const db = getDb();

  // 1. Try local HMAC-signed JWT session token
  const localPayload = verifySessionToken(token);
  if (localPayload) {
    const row = db
      .prepare('SELECT id, firebase_uid, email, display_name, role FROM users WHERE id = ?')
      .get(localPayload.sub) as
      | { id: string; firebase_uid: string | null; email: string; display_name: string; role: string }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      firebaseUid: row.firebase_uid,
    };
  }

  // 2. Fallback to verifying Firebase Auth ID Token
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const email = (decoded.email || '').toLowerCase();
    if (!email) return null;

    const existing = db
      .prepare('SELECT id, firebase_uid, email, display_name, role FROM users WHERE firebase_uid = ? OR email = ?')
      .get(decoded.uid, email) as
      | { id: string; firebase_uid: string | null; email: string; display_name: string; role: string }
      | undefined;

    if (existing) {
      if (!existing.firebase_uid) {
        db.prepare('UPDATE users SET firebase_uid = ?, updated_at = ? WHERE id = ?').run(
          decoded.uid,
          new Date().toISOString(),
          existing.id
        );
      }
      return {
        id: existing.id,
        email: existing.email,
        displayName: existing.display_name,
        role: existing.role,
        firebaseUid: decoded.uid,
      };
    }

    const now = new Date().toISOString();
    const newId = crypto.randomUUID();
    const displayName = decoded.name || email.split('@')[0];
    db.prepare(
      `INSERT INTO users (id, firebase_uid, email, display_name, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'patient', ?, ?)`
    ).run(newId, decoded.uid, email, displayName, now, now);

    return {
      id: newId,
      email,
      displayName,
      role: 'patient',
      firebaseUid: decoded.uid,
    };
  } catch {
    return null;
  }
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  const user = await resolveAuthUser(token);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired authentication session.' });
    return;
  }

  req.authUser = user;
  next();
};

export function logAudit(params: {
  userId?: string | null;
  requestId: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  statusCode: number;
  ipAddress?: string;
}): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO audit_logs (id, user_id, request_id, action, resource_type, resource_id, status_code, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      params.userId ?? null,
      params.requestId,
      params.action,
      params.resourceType,
      params.resourceId ?? null,
      params.statusCode,
      params.ipAddress ?? '',
      new Date().toISOString()
    );
  } catch {
    // Non-blocking audit logging
  }
}

const rateBuckets = new Map<string, number[]>();

export function createRateLimiter(windowMs: number, maxRequests: number) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const key = `${req.path}:${req.authUser?.id || req.ip || 'anon'}`;
    const now = Date.now();
    const entries = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
    if (entries.length >= maxRequests) {
      res.status(429).json({ error: 'Too many requests. Please wait briefly before trying again.' });
      return;
    }
    entries.push(now);
    rateBuckets.set(key, entries);
    next();
  };
}

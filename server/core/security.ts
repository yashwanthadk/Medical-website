import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.ts';
import { getDb } from './database.ts';

export const DEFAULT_WORKSPACE_ID = 'public-workspace';
const WORKSPACE_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;

export interface WorkspaceRequest extends Request {
  workspaceId?: string;
  requestId?: string;
}

export type AuthRequest = WorkspaceRequest;

function base64UrlEncode(data: string | Buffer): string {
  return Buffer.from(data)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function resolveWorkspaceId(req: Request): string {
  const raw = req.headers['x-workspace-id'];
  const headerVal = typeof raw === 'string' ? raw.trim() : '';
  if (WORKSPACE_ID_PATTERN.test(headerVal)) {
    return headerVal;
  }
  return DEFAULT_WORKSPACE_ID;
}

export function attachWorkspace(req: WorkspaceRequest, _res: Response, next: NextFunction): void {
  req.workspaceId = resolveWorkspaceId(req);
  next();
}

export function signFileAccessToken(fileId: string, ownerId: string, ttlSeconds = 86400): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const data = `${fileId}:${ownerId}:${exp}`;
  const sig = base64UrlEncode(
    crypto.createHmac('sha256', config.sessionSecret).update(data).digest()
  );
  return `${exp}.${sig}`;
}

export function verifyFileAccessToken(token: string, fileId: string, ownerId: string): boolean {
  try {
    const [expStr, sig] = token.split('.');
    const exp = Number(expStr);
    if (!exp || exp < Math.floor(Date.now() / 1000)) return false;
    const data = `${fileId}:${ownerId}:${exp}`;
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

export function asyncHandler(
  fn: (req: WorkspaceRequest, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: WorkspaceRequest, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export async function logAudit(params: {
  userId?: string | null;
  requestId: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  statusCode: number;
  ipAddress?: string;
}): Promise<void> {
  try {
    const db = await getDb();
    await db.execute(
      `INSERT INTO audit_logs (id, user_id, request_id, action, resource_type, resource_id, status_code, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        params.userId ?? null,
        params.requestId,
        params.action,
        params.resourceType,
        params.resourceId ?? null,
        params.statusCode,
        params.ipAddress ?? '',
        new Date().toISOString(),
      ]
    );
  } catch {
    // Non-blocking audit logging
  }
}

const rateBuckets = new Map<string, number[]>();

export function createRateLimiter(windowMs: number, maxRequests: number) {
  return (req: WorkspaceRequest, res: Response, next: NextFunction): void => {
    const key = `${req.path}:${req.workspaceId || req.ip || 'anon'}`;
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

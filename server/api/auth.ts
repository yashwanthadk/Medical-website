import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import { getDb } from '../core/database.ts';
import { adminAuth } from '../core/firebaseAdmin.ts';
import {
  createRateLimiter,
  hashPassword,
  logAudit,
  requireAuth,
  signSessionToken,
  validatePasswordStrength,
  verifyPassword,
  type AuthRequest,
} from '../core/security.ts';

export const authRouter = Router();
const authLimiter = createRateLimiter(60_000, 30);

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

// POST /api/v1/auth/register (Signup + Create Password)
authRouter.post('/register', authLimiter, (req: AuthRequest, res: Response) => {
  const { email, password, confirmPassword, displayName } = req.body ?? {};
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const cleanName = typeof displayName === 'string' ? displayName.trim().slice(0, 100) : '';

  if (!isValidEmail(cleanEmail)) {
    res.status(400).json({ error: 'Please provide a valid email address.' });
    return;
  }
  if (!cleanName) {
    res.status(400).json({ error: 'Please enter your full name.' });
    return;
  }
  if (typeof confirmPassword === 'string' && password !== confirmPassword) {
    res.status(400).json({ error: 'Passwords do not match.' });
    return;
  }

  const strength = validatePasswordStrength(password);
  if (!strength.valid) {
    res.status(400).json({ error: strength.reason });
    return;
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail) as
    | { id: string }
    | undefined;
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
    return;
  }

  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const passwordHash = hashPassword(password);

  db.prepare(
    `INSERT INTO users (id, firebase_uid, email, display_name, password_hash, role, created_at, updated_at)
     VALUES (?, NULL, ?, ?, ?, 'patient', ?, ?)`
  ).run(userId, cleanEmail, cleanName, passwordHash, now, now);

  const token = signSessionToken(userId, cleanEmail);
  logAudit({
    userId,
    requestId: req.requestId || 'req',
    action: 'AUTH_REGISTER',
    resourceType: 'user',
    resourceId: userId,
    statusCode: 201,
    ipAddress: req.ip,
  });

  res.status(201).json({
    token,
    user: {
      id: userId,
      email: cleanEmail,
      displayName: cleanName,
      role: 'patient',
      hasPassword: true,
    },
  });
});

// POST /api/v1/auth/login (Email + Password)
authRouter.post('/login', authLimiter, (req: AuthRequest, res: Response) => {
  const { email, password } = req.body ?? {};
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!isValidEmail(cleanEmail) || typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const db = getDb();
  const user = db
    .prepare(
      'SELECT id, email, display_name, password_hash, role FROM users WHERE email = ?'
    )
    .get(cleanEmail) as
    | { id: string; email: string; display_name: string; password_hash: string | null; role: string }
    | undefined;

  if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
    logAudit({
      userId: user?.id ?? null,
      requestId: req.requestId || 'req',
      action: 'AUTH_LOGIN_FAILED',
      resourceType: 'user',
      resourceId: user?.id ?? null,
      statusCode: 401,
      ipAddress: req.ip,
    });
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  const token = signSessionToken(user.id, user.email);
  logAudit({
    userId: user.id,
    requestId: req.requestId || 'req',
    action: 'AUTH_LOGIN',
    resourceType: 'user',
    resourceId: user.id,
    statusCode: 200,
    ipAddress: req.ip,
  });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      hasPassword: true,
    },
  });
});

// POST /api/v1/auth/firebase (Exchange Firebase ID Token from Google Sign-In)
authRouter.post('/firebase', authLimiter, async (req: AuthRequest, res: Response) => {
  const { idToken } = req.body ?? {};
  if (typeof idToken !== 'string' || !idToken.trim()) {
    res.status(400).json({ error: 'Firebase ID token is required.' });
    return;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(idToken);
    const email = (decoded.email || '').toLowerCase();
    if (!email) {
      res.status(400).json({ error: 'Authenticated Google account must include an email address.' });
      return;
    }

    const db = getDb();
    const existing = db
      .prepare('SELECT id, firebase_uid, email, display_name, password_hash, role FROM users WHERE firebase_uid = ? OR email = ?')
      .get(decoded.uid, email) as
      | {
          id: string;
          firebase_uid: string | null;
          email: string;
          display_name: string;
          password_hash: string | null;
          role: string;
        }
      | undefined;

    const now = new Date().toISOString();
    let userRecord: {
      id: string;
      email: string;
      displayName: string;
      role: string;
      hasPassword: boolean;
    };

    if (existing) {
      if (!existing.firebase_uid) {
        db.prepare('UPDATE users SET firebase_uid = ?, updated_at = ? WHERE id = ?').run(
          decoded.uid,
          now,
          existing.id
        );
      }
      userRecord = {
        id: existing.id,
        email: existing.email,
        displayName: existing.display_name,
        role: existing.role,
        hasPassword: Boolean(existing.password_hash),
      };
    } else {
      const userId = crypto.randomUUID();
      const displayName = decoded.name || email.split('@')[0];
      db.prepare(
        `INSERT INTO users (id, firebase_uid, email, display_name, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, 'patient', ?, ?)`
      ).run(userId, decoded.uid, email, displayName, now, now);
      userRecord = {
        id: userId,
        email,
        displayName,
        role: 'patient',
        hasPassword: false,
      };
    }

    const token = signSessionToken(userRecord.id, userRecord.email);
    logAudit({
      userId: userRecord.id,
      requestId: req.requestId || 'req',
      action: 'AUTH_FIREBASE_LOGIN',
      resourceType: 'user',
      resourceId: userRecord.id,
      statusCode: 200,
      ipAddress: req.ip,
    });

    res.json({ token, user: userRecord });
  } catch {
    res.status(401).json({ error: 'Unable to verify Google authentication token.' });
  }
});

// POST /api/v1/auth/forgot-password (Initiate New Create Password recovery)
authRouter.post('/forgot-password', authLimiter, (req: AuthRequest, res: Response) => {
  const { email } = req.body ?? {};
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!isValidEmail(cleanEmail)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }

  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail) as
    | { id: string }
    | undefined;

  if (!user) {
    res.status(404).json({
      error: 'No account found with that email address. Please sign up first.',
    });
    return;
  }

  const code = String(crypto.randomInt(100000, 999999));
  const codeHash = hashPassword(code);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  db.prepare(
    'UPDATE users SET reset_code_hash = ?, reset_code_expires_at = ?, updated_at = ? WHERE id = ?'
  ).run(codeHash, expiresAt, new Date().toISOString(), user.id);

  logAudit({
    userId: user.id,
    requestId: req.requestId || 'req',
    action: 'AUTH_PASSWORD_RESET_REQUESTED',
    resourceType: 'user',
    resourceId: user.id,
    statusCode: 200,
    ipAddress: req.ip,
  });

  res.json({
    message:
      'Verification code generated. Since no external SMTP mail server is configured in this preview environment, enter the code below to set your new password.',
    verificationCode: code,
    expiresInMinutes: 15,
  });
});

// POST /api/v1/auth/reset-password (New Create Password with verification code)
authRouter.post('/reset-password', authLimiter, (req: AuthRequest, res: Response) => {
  const { email, code, newPassword, confirmPassword } = req.body ?? {};
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!isValidEmail(cleanEmail) || typeof code !== 'string' || !code.trim()) {
    res.status(400).json({ error: 'Email and 6-digit verification code are required.' });
    return;
  }
  if (newPassword !== confirmPassword) {
    res.status(400).json({ error: 'New passwords do not match.' });
    return;
  }

  const strength = validatePasswordStrength(newPassword);
  if (!strength.valid) {
    res.status(400).json({ error: strength.reason });
    return;
  }

  const db = getDb();
  const user = db
    .prepare(
      'SELECT id, reset_code_hash, reset_code_expires_at FROM users WHERE email = ?'
    )
    .get(cleanEmail) as
    | { id: string; reset_code_hash: string | null; reset_code_expires_at: string | null }
    | undefined;

  if (!user || !user.reset_code_hash || !user.reset_code_expires_at) {
    res.status(400).json({ error: 'No active password reset request found for this account.' });
    return;
  }
  if (new Date(user.reset_code_expires_at).getTime() < Date.now()) {
    res.status(400).json({ error: 'Verification code has expired. Please request a new code.' });
    return;
  }
  if (!verifyPassword(code.trim(), user.reset_code_hash)) {
    res.status(400).json({ error: 'Invalid verification code.' });
    return;
  }

  const newHash = hashPassword(newPassword);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE users
     SET password_hash = ?, reset_code_hash = NULL, reset_code_expires_at = NULL, updated_at = ?
     WHERE id = ?`
  ).run(newHash, now, user.id);

  logAudit({
    userId: user.id,
    requestId: req.requestId || 'req',
    action: 'AUTH_PASSWORD_RESET_COMPLETED',
    resourceType: 'user',
    resourceId: user.id,
    statusCode: 200,
    ipAddress: req.ip,
  });

  res.json({ message: 'Your new password has been saved. You can now sign in.' });
});

// POST /api/v1/auth/change-password (Authenticated Create/Update New Password)
authRouter.post('/change-password', requireAuth, (req: AuthRequest, res: Response) => {
  const { currentPassword, newPassword, confirmPassword } = req.body ?? {};
  const userId = req.authUser!.id;

  if (newPassword !== confirmPassword) {
    res.status(400).json({ error: 'New passwords do not match.' });
    return;
  }
  const strength = validatePasswordStrength(newPassword);
  if (!strength.valid) {
    res.status(400).json({ error: strength.reason });
    return;
  }

  const db = getDb();
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
    | { password_hash: string | null }
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'Account not found.' });
    return;
  }

  // If the account already has a password (not Google-only), require current password
  if (row.password_hash) {
    if (typeof currentPassword !== 'string' || !verifyPassword(currentPassword, row.password_hash)) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }
  }

  const newHash = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    newHash,
    new Date().toISOString(),
    userId
  );

  logAudit({
    userId,
    requestId: req.requestId || 'req',
    action: 'AUTH_PASSWORD_CHANGED',
    resourceType: 'user',
    resourceId: userId,
    statusCode: 200,
    ipAddress: req.ip,
  });

  res.json({ message: 'Password updated successfully.' });
});

// POST /api/v1/auth/logout
authRouter.post('/logout', (_req: AuthRequest, res: Response) => {
  res.json({ message: 'Signed out successfully.' });
});

// GET /api/v1/auth/me
authRouter.get('/me', requireAuth, (req: AuthRequest, res: Response) => {
  const db = getDb();
  const row = db
    .prepare('SELECT id, email, display_name, role, password_hash, created_at FROM users WHERE id = ?')
    .get(req.authUser!.id) as
    | {
        id: string;
        email: string;
        display_name: string;
        role: string;
        password_hash: string | null;
        created_at: string;
      }
    | undefined;

  if (!row) {
    res.status(404).json({ error: 'User profile not found.' });
    return;
  }

  res.json({
    user: {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      hasPassword: Boolean(row.password_hash),
      createdAt: row.created_at,
    },
  });
});

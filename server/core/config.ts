import dotenv from 'dotenv';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

dotenv.config();

const STORAGE_ROOT = path.resolve(process.cwd(), 'server/storage');
const PRIVATE_STORAGE_DIR = path.join(STORAGE_ROOT, 'private');
const SECRET_FILE = path.join(STORAGE_ROOT, '.session_secret');

export function ensureStorageDirs(): void {
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  fs.mkdirSync(PRIVATE_STORAGE_DIR, { recursive: true });
}

function resolveSessionSecret(): string {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return process.env.SESSION_SECRET;
  }
  ensureStorageDirs();
  if (fs.existsSync(SECRET_FILE)) {
    const existing = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (existing.length >= 32) return existing;
  }
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
  return generated;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_SIZE_MB || 20) * 1024 * 1024,
  storageRoot: STORAGE_ROOT,
  privateStorageDir: PRIVATE_STORAGE_DIR,
  get dbPath(): string {
    return process.env.TEST_DB_PATH || path.join(STORAGE_ROOT, 'mediexplain.db');
  },
  sessionSecret: resolveSessionSecret(),
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: 'gemini-4-hydrogen',
  sessionTtlSeconds: 60 * 60 * 24 * 7, // 7 days
};

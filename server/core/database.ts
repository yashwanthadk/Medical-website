import fs from 'node:fs';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { config, ensureStorageDirs } from './config.ts';

export interface DbClient {
  dialect: 'postgres' | 'sqlite';
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  queryAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface DbAdapter extends DbClient {
  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
}

interface SqliteLikeStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
}

interface SqliteLikeDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteLikeStatement;
  close(): void;
}

function translatePgPlaceholders(sql: string): string {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

let pgPool: Pool | null = null;
let sqliteDb: SqliteLikeDb | null = null;
let initPromise: Promise<void> | null = null;
let cachedAdapter: DbAdapter | null = null;

async function openSqlite(): Promise<SqliteLikeDb> {
  if (sqliteDb) return sqliteDb;

  if (config.dbPath !== ':memory:') {
    ensureStorageDirs();
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  }

  let db: SqliteLikeDb;
  try {
    const mod = await import('better-sqlite3');
    const BetterSqlite3 = (mod.default || mod) as unknown as new (p: string) => SqliteLikeDb & {
      pragma(s: string): void;
    };
    const instance = new BetterSqlite3(config.dbPath);
    instance.pragma('journal_mode = WAL');
    instance.pragma('foreign_keys = ON');
    db = instance;
  } catch {
    // Fallback to Node 22+ built-in node:sqlite if native better-sqlite3 addon isn't bundled
    const { DatabaseSync } = await import('node:sqlite');
    const instance = new DatabaseSync(config.dbPath);
    instance.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    db = instance as unknown as SqliteLikeDb;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      firebase_uid TEXT UNIQUE,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'patient',
      reset_code_hash TEXT,
      reset_code_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS medical_reports (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      report_type TEXT NOT NULL CHECK (report_type IN ('xray', 'mri', 'blood')),
      title TEXT NOT NULL,
      clinical_notes TEXT DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('uploaded', 'queued', 'processing', 'completed', 'failed')),
      urgent_flag INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS uploaded_files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      report_id TEXT,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      sha256_hash TEXT NOT NULL,
      file_category TEXT NOT NULL CHECK (file_category IN ('xray', 'mri', 'blood')),
      file_data BLOB,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (report_id) REFERENCES medical_reports(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      summary_plain TEXT NOT NULL DEFAULT '',
      structured_json TEXT NOT NULL DEFAULT '{}',
      extracted_text TEXT NOT NULL DEFAULT '',
      limitations TEXT NOT NULL DEFAULT '',
      disclaimer TEXT NOT NULL DEFAULT '',
      urgent_flag INTEGER NOT NULL DEFAULT 0,
      urgent_reason TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (report_id) REFERENCES medical_reports(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS blood_test_results (
      id TEXT PRIMARY KEY,
      analysis_id TEXT NOT NULL,
      report_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      test_name TEXT NOT NULL,
      measured_value TEXT NOT NULL,
      numeric_value REAL,
      unit TEXT NOT NULL DEFAULT '',
      reference_range TEXT NOT NULL DEFAULT 'Unknown',
      ref_min REAL,
      ref_max REAL,
      status TEXT NOT NULL CHECK (status IN ('Normal', 'High', 'Low', 'Unknown')),
      simple_explanation TEXT NOT NULL DEFAULT '',
      extraction_confidence TEXT NOT NULL DEFAULT 'Medium',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE,
      FOREIGN KEY (report_id) REFERENCES medical_reports(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      report_id TEXT,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (report_id) REFERENCES medical_reports(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS processing_jobs (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      analysis_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      job_type TEXT NOT NULL CHECK (job_type IN ('xray', 'mri', 'blood')),
      status TEXT NOT NULL CHECK (status IN ('uploaded', 'queued', 'processing', 'completed', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      error_message TEXT NOT NULL DEFAULT '',
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (report_id) REFERENCES medical_reports(id) ON DELETE CASCADE,
      FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      request_id TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      status_code INTEGER NOT NULL,
      ip_address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reports_user_created ON medical_reports(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_files_user_hash ON uploaded_files(user_id, sha256_hash);
    CREATE INDEX IF NOT EXISTS idx_analyses_report ON analyses(report_id);
    CREATE INDEX IF NOT EXISTS idx_blood_results_report ON blood_test_results(report_id);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_jobs_analysis ON processing_jobs(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at DESC);
  `);

  // Safe migrations for pre-existing local SQLite databases
  try {
    const fileCols = db.prepare('PRAGMA table_info(uploaded_files)').all() as Array<{ name: string }>;
    if (!fileCols.some((c) => c.name === 'file_data')) {
      db.exec('ALTER TABLE uploaded_files ADD COLUMN file_data BLOB;');
    }
    const bloodCols = db
      .prepare('PRAGMA table_info(blood_test_results)')
      .all() as Array<{ name: string }>;
    if (!bloodCols.some((c) => c.name === 'sort_order')) {
      db.exec('ALTER TABLE blood_test_results ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;');
    }
  } catch {
    // Ignore if already migrated
  }

  sqliteDb = db;
  return db;
}

async function initPostgresSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      firebase_uid TEXT UNIQUE,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'patient',
      reset_code_hash TEXT,
      reset_code_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS medical_reports (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      report_type TEXT NOT NULL CHECK (report_type IN ('xray', 'mri', 'blood')),
      title TEXT NOT NULL,
      clinical_notes TEXT DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('uploaded', 'queued', 'processing', 'completed', 'failed')),
      urgent_flag INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS uploaded_files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      report_id TEXT REFERENCES medical_reports(id) ON DELETE SET NULL,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      sha256_hash TEXT NOT NULL,
      file_category TEXT NOT NULL CHECK (file_category IN ('xray', 'mri', 'blood')),
      file_data BYTEA,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL UNIQUE REFERENCES medical_reports(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      model_name TEXT NOT NULL,
      summary_plain TEXT NOT NULL DEFAULT '',
      structured_json TEXT NOT NULL DEFAULT '{}',
      extracted_text TEXT NOT NULL DEFAULT '',
      limitations TEXT NOT NULL DEFAULT '',
      disclaimer TEXT NOT NULL DEFAULT '',
      urgent_flag INTEGER NOT NULL DEFAULT 0,
      urgent_reason TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blood_test_results (
      id TEXT PRIMARY KEY,
      analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
      report_id TEXT NOT NULL REFERENCES medical_reports(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      test_name TEXT NOT NULL,
      measured_value TEXT NOT NULL,
      numeric_value DOUBLE PRECISION,
      unit TEXT NOT NULL DEFAULT '',
      reference_range TEXT NOT NULL DEFAULT 'Unknown',
      ref_min DOUBLE PRECISION,
      ref_max DOUBLE PRECISION,
      status TEXT NOT NULL CHECK (status IN ('Normal', 'High', 'Low', 'Unknown')),
      simple_explanation TEXT NOT NULL DEFAULT '',
      extraction_confidence TEXT NOT NULL DEFAULT 'Medium',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      report_id TEXT REFERENCES medical_reports(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS processing_jobs (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL REFERENCES medical_reports(id) ON DELETE CASCADE,
      analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      job_type TEXT NOT NULL CHECK (job_type IN ('xray', 'mri', 'blood')),
      status TEXT NOT NULL CHECK (status IN ('uploaded', 'queued', 'processing', 'completed', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      error_message TEXT NOT NULL DEFAULT '',
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      request_id TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      status_code INTEGER NOT NULL,
      ip_address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reports_user_created ON medical_reports(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_files_user_hash ON uploaded_files(user_id, sha256_hash);
    CREATE INDEX IF NOT EXISTS idx_analyses_report ON analyses(report_id);
    CREATE INDEX IF NOT EXISTS idx_blood_results_report ON blood_test_results(report_id);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_jobs_analysis ON processing_jobs(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at DESC);
  `);
}

function makePgClient(runner: Pool | PoolClient): DbClient {
  return {
    dialect: 'postgres',
    async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await runner.query(translatePgPlaceholders(sql), params);
      return res.rows[0] as T | undefined;
    },
    async queryAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await runner.query(translatePgPlaceholders(sql), params);
      return res.rows as T[];
    },
    async execute(sql: string, params: unknown[] = []) {
      await runner.query(translatePgPlaceholders(sql), params);
    },
  };
}

function makeSqliteClient(db: SqliteLikeDb): DbClient {
  return {
    dialect: 'sqlite',
    async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).get(...params) as T | undefined;
    },
    async queryAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async execute(sql: string, params: unknown[] = []) {
      db.prepare(sql).run(...params);
    },
  };
}

export async function ensureDbReady(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const dbUrl = config.databaseUrl;
    if (dbUrl) {
      const useSsl =
        !dbUrl.includes('localhost') &&
        !dbUrl.includes('127.0.0.1') &&
        !dbUrl.includes('sslmode=disable');

      pgPool = new Pool({
        connectionString: dbUrl,
        max: config.isServerless ? 3 : 10,
        connectionTimeoutMillis: 15000,
        ssl: useSsl ? { rejectUnauthorized: false } : false,
      });

      pgPool.on('error', (err) => {
        console.error('Unexpected error on PostgreSQL pool:', err.message);
      });

      await initPostgresSchema(pgPool);
      const base = makePgClient(pgPool);
      cachedAdapter = {
        ...base,
        async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
          const client = await pgPool!.connect();
          try {
            await client.query('BEGIN');
            const result = await fn(makePgClient(client));
            await client.query('COMMIT');
            return result;
          } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
          } finally {
            client.release();
          }
        },
      };
    } else {
      const db = await openSqlite();
      const base = makeSqliteClient(db);
      cachedAdapter = {
        ...base,
        async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
          db.exec('BEGIN IMMEDIATE');
          try {
            const result = await fn(base);
            db.exec('COMMIT');
            return result;
          } catch (err) {
            try {
              db.exec('ROLLBACK');
            } catch {
              // Ignore rollback errors
            }
            throw err;
          }
        },
      };
    }
  })().catch((err) => {
    initPromise = null;
    throw err;
  });

  return initPromise;
}

export async function getDb(): Promise<DbAdapter> {
  await ensureDbReady();
  return cachedAdapter!;
}

export function getPersistenceMode(): 'postgres' | 'sqlite_tmp' | 'sqlite_disk' {
  if (config.databaseUrl) return 'postgres';
  return config.isServerless ? 'sqlite_tmp' : 'sqlite_disk';
}

export async function closeDb(): Promise<void> {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
  }
  cachedAdapter = null;
  initPromise = null;
}

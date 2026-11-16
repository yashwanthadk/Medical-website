import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { config, ensureStorageDirs } from './config.ts';

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  if (config.dbPath !== ':memory:') {
    ensureStorageDirs();
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  }

  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

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

  dbInstance = db;
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

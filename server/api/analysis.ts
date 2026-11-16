import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import { config } from '../core/config.ts';
import { getDb } from '../core/database.ts';
import {
  createRateLimiter,
  logAudit,
  requireAuth,
  signFileAccessToken,
  type AuthRequest,
} from '../core/security.ts';
import { enqueueAnalysisJob } from '../workers/analysisWorker.ts';

export const analysisRouter = Router();
const aiLimiter = createRateLimiter(60_000, 20);

function triggerAnalysis(reportType: 'xray' | 'mri' | 'blood') {
  return (req: AuthRequest, res: Response) => {
    const userId = req.authUser!.id;
    const { fileId, title, clinicalNotes } = req.body ?? {};

    if (typeof fileId !== 'string' || !fileId.trim()) {
      res.status(400).json({ error: 'fileId is required to start analysis.' });
      return;
    }

    const db = getDb();
    const fileRow = db
      .prepare(
        `SELECT id, user_id, original_filename, storage_path, mime_type, file_category
         FROM uploaded_files WHERE id = ?`
      )
      .get(fileId.trim()) as
      | {
          id: string;
          user_id: string;
          original_filename: string;
          storage_path: string;
          mime_type: string;
          file_category: string;
        }
      | undefined;

    if (!fileRow) {
      res.status(404).json({ error: 'Uploaded file not found.' });
      return;
    }
    if (fileRow.user_id !== userId) {
      res.status(403).json({ error: 'Forbidden: you do not own this uploaded file.' });
      return;
    }
    if (fileRow.file_category !== reportType) {
      res.status(400).json({
        error: `This file was uploaded for ${fileRow.file_category.toUpperCase()} workflow, not ${reportType.toUpperCase()}.`,
      });
      return;
    }

    const reportId = crypto.randomUUID();
    const analysisId = crypto.randomUUID();
    const now = new Date().toISOString();
    const cleanTitle =
      typeof title === 'string' && title.trim()
        ? title.trim().slice(0, 180)
        : fileRow.original_filename;
    const cleanNotes =
      typeof clinicalNotes === 'string' ? clinicalNotes.trim().slice(0, 1000) : '';

    db.transaction(() => {
      db.prepare(
        `INSERT INTO medical_reports (id, user_id, report_type, title, clinical_notes, status, urgent_flag, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'uploaded', 0, ?, ?)`
      ).run(reportId, userId, reportType, cleanTitle, cleanNotes, now, now);

      db.prepare('UPDATE uploaded_files SET report_id = ? WHERE id = ?').run(reportId, fileRow.id);

      db.prepare(
        `INSERT INTO analyses (id, report_id, user_id, model_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(analysisId, reportId, userId, config.geminiModel, now, now);
    })();

    const jobId = enqueueAnalysisJob({
      reportId,
      analysisId,
      userId,
      jobType: reportType,
      filePath: fileRow.storage_path,
      mimeType: fileRow.mime_type,
      clinicalNotes: cleanNotes,
    });

    logAudit({
      userId,
      requestId: req.requestId || 'req',
      action: `ANALYSIS_${reportType.toUpperCase()}_STARTED`,
      resourceType: 'analysis',
      resourceId: analysisId,
      statusCode: 202,
      ipAddress: req.ip,
    });

    res.status(202).json({
      reportId,
      analysisId,
      jobId,
      status: 'queued',
    });
  };
}

analysisRouter.post('/xray', requireAuth, aiLimiter, triggerAnalysis('xray'));
analysisRouter.post('/mri', requireAuth, aiLimiter, triggerAnalysis('mri'));
analysisRouter.post('/blood', requireAuth, aiLimiter, triggerAnalysis('blood'));

// GET /api/v1/analysis/:analysisId/status
analysisRouter.get('/:analysisId/status', requireAuth, (req: AuthRequest, res: Response) => {
  const userId = req.authUser!.id;
  const { analysisId } = req.params;
  const db = getDb();

  const row = db
    .prepare(
      `SELECT j.id as job_id, j.report_id, j.analysis_id, j.user_id, j.job_type, j.status,
              j.attempts, j.error_message, j.started_at, j.completed_at, j.updated_at
       FROM processing_jobs j
       WHERE j.analysis_id = ?
       ORDER BY j.created_at DESC LIMIT 1`
    )
    .get(analysisId) as
    | {
        job_id: string;
        report_id: string;
        analysis_id: string;
        user_id: string;
        job_type: string;
        status: string;
        attempts: number;
        error_message: string;
        started_at: string | null;
        completed_at: string | null;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    res.status(404).json({ error: 'Analysis job not found.' });
    return;
  }
  if (row.user_id !== userId) {
    res.status(403).json({ error: 'Forbidden: you do not have access to this analysis.' });
    return;
  }

  res.json({
    jobId: row.job_id,
    reportId: row.report_id,
    analysisId: row.analysis_id,
    jobType: row.job_type,
    status: row.status,
    attempts: row.attempts,
    errorMessage: row.error_message || null,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  });
});

// GET /api/v1/analysis/:analysisId
analysisRouter.get('/:analysisId', requireAuth, (req: AuthRequest, res: Response) => {
  const userId = req.authUser!.id;
  const { analysisId } = req.params;
  const db = getDb();

  const row = db
    .prepare(
      `SELECT a.id as analysis_id, a.report_id, a.user_id, a.model_name, a.summary_plain,
              a.structured_json, a.extracted_text, a.limitations, a.disclaimer,
              a.urgent_flag, a.urgent_reason, a.error_message, a.created_at, a.updated_at,
              r.report_type, r.title, r.clinical_notes, r.status as report_status,
              f.id as file_id, f.original_filename, f.mime_type, f.file_size
       FROM analyses a
       INNER JOIN medical_reports r ON r.id = a.report_id
       LEFT JOIN uploaded_files f ON f.report_id = r.id
       WHERE a.id = ?`
    )
    .get(analysisId) as
    | {
        analysis_id: string;
        report_id: string;
        user_id: string;
        model_name: string;
        summary_plain: string;
        structured_json: string;
        extracted_text: string;
        limitations: string;
        disclaimer: string;
        urgent_flag: number;
        urgent_reason: string;
        error_message: string;
        created_at: string;
        updated_at: string;
        report_type: string;
        title: string;
        clinical_notes: string;
        report_status: string;
        file_id: string | null;
        original_filename: string | null;
        mime_type: string | null;
        file_size: number | null;
      }
    | undefined;

  if (!row) {
    res.status(404).json({ error: 'Analysis not found.' });
    return;
  }
  if (row.user_id !== userId) {
    res.status(403).json({ error: 'Forbidden: you do not have access to this analysis.' });
    return;
  }

  let structured: unknown = {};
  try {
    structured = JSON.parse(row.structured_json || '{}');
  } catch {
    structured = {};
  }

  const bloodResults =
    row.report_type === 'blood'
      ? db
          .prepare(
            `SELECT id, test_name, measured_value, numeric_value, unit, reference_range,
                    ref_min, ref_max, status, simple_explanation, extraction_confidence
             FROM blood_test_results
             WHERE analysis_id = ?
             ORDER BY rowid ASC`
          )
          .all(row.analysis_id)
      : [];

  const previewToken = row.file_id ? signFileAccessToken(row.file_id, userId, 900) : null;

  res.json({
    analysisId: row.analysis_id,
    reportId: row.report_id,
    reportType: row.report_type,
    title: row.title,
    clinicalNotes: row.clinical_notes,
    status: row.report_status,
    modelName: row.model_name,
    summaryPlain: row.summary_plain,
    structured,
    bloodResults,
    extractedText: row.extracted_text,
    limitations: row.limitations,
    disclaimer: row.disclaimer,
    urgentFlag: Boolean(row.urgent_flag),
    urgentReason: row.urgent_reason,
    errorMessage: row.error_message || null,
    file: row.file_id
      ? {
          fileId: row.file_id,
          originalFilename: row.original_filename,
          mimeType: row.mime_type,
          fileSize: row.file_size,
          signedPreviewUrl: `/api/v1/uploads/${row.file_id}?token=${encodeURIComponent(previewToken!)}`,
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

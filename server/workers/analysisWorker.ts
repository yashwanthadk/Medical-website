import crypto from 'node:crypto';
import fs from 'node:fs';
import { getDb } from '../core/database.ts';
import { config } from '../core/config.ts';
import { extractPdfText } from '../services/pdfExtraction.ts';
import {
  getAIProvider,
  type BloodReportAnalysisOutput,
  type MRIAnalysisOutput,
  type XRayAnalysisOutput,
} from '../services/aiService.ts';

export interface EnqueueJobParams {
  reportId: string;
  analysisId: string;
  userId: string;
  jobType: 'xray' | 'mri' | 'blood';
  filePath: string;
  mimeType: string;
  clinicalNotes: string;
}

const activeJobs = new Set<string>();

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('rate limit')
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Analysis timed out while waiting for AI response.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sanitizePublicError(err: unknown): string {
  const msg = err instanceof Error ? err.message : 'Analysis failed due to an unexpected processing error.';
  if (msg.includes('GEMINI_API_KEY')) {
    return 'AI service is not configured on the server (missing GEMINI_API_KEY).';
  }
  if (msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED')) {
    return 'The configured AI API key was rejected or lacks permission. Please verify GEMINI_API_KEY in Settings > Secrets.';
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
    return 'AI service rate limit reached. Please wait a moment and try again.';
  }
  return msg.slice(0, 400);
}

export function enqueueAnalysisJob(params: EnqueueJobParams): string {
  const db = getDb();
  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO processing_jobs (id, report_id, analysis_id, user_id, job_type, status, attempts, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', 0, '', ?, ?)`
  ).run(jobId, params.reportId, params.analysisId, params.userId, params.jobType, now, now);

  db.prepare(`UPDATE medical_reports SET status = 'queued', updated_at = ? WHERE id = ?`).run(
    now,
    params.reportId
  );

  // Execute asynchronously so the HTTP upload/trigger endpoint returns immediately with job status
  setImmediate(() => {
    void processJob(jobId, params);
  });

  return jobId;
}

export async function processJob(jobId: string, params: EnqueueJobParams): Promise<void> {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);

  const db = getDb();
  const maxAttempts = 2;

  try {
    // Idempotency guard: if already completed, skip
    const existingJob = db
      .prepare('SELECT status FROM processing_jobs WHERE id = ?')
      .get(jobId) as { status: string } | undefined;
    if (!existingJob || existingJob.status === 'completed') return;

    const startTime = new Date().toISOString();
    db.prepare(
      `UPDATE processing_jobs SET status = 'processing', started_at = ?, updated_at = ? WHERE id = ?`
    ).run(startTime, startTime, jobId);
    db.prepare(`UPDATE medical_reports SET status = 'processing', updated_at = ? WHERE id = ?`).run(
      startTime,
      params.reportId
    );

    if (!fs.existsSync(params.filePath)) {
      throw new Error('Source medical file is no longer available in private storage.');
    }
    const fileBuffer = fs.readFileSync(params.filePath);
    const ai = getAIProvider();

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      db.prepare('UPDATE processing_jobs SET attempts = ?, updated_at = ? WHERE id = ?').run(
        attempt,
        new Date().toISOString(),
        jobId
      );

      try {
        if (params.jobType === 'xray') {
          const result: XRayAnalysisOutput = await withTimeout(
            ai.analyzeXRay({
              buffer: fileBuffer,
              mimeType: params.mimeType,
              clinicalNotes: params.clinicalNotes,
            }),
            90000
          );
          saveXRayResult(params, result);
        } else if (params.jobType === 'mri') {
          const result: MRIAnalysisOutput = await withTimeout(
            ai.analyzeMRI({
              buffer: fileBuffer,
              mimeType: params.mimeType,
              clinicalNotes: params.clinicalNotes,
            }),
            90000
          );
          saveMRIResult(params, result);
        } else {
          let extractedText = '';
          if (params.mimeType === 'application/pdf') {
            const pdfData = await extractPdfText(fileBuffer);
            extractedText = pdfData.text;
          }
          const result: BloodReportAnalysisOutput = await withTimeout(
            ai.analyzeBloodReport({
              buffer: fileBuffer,
              mimeType: params.mimeType,
              extractedText,
              clinicalNotes: params.clinicalNotes,
            }),
            95000
          );
          saveBloodResult(params, result, extractedText);
        }

        const doneAt = new Date().toISOString();
        db.prepare(
          `UPDATE processing_jobs SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?`
        ).run(doneAt, doneAt, jobId);
        db.prepare(`UPDATE medical_reports SET status = 'completed', updated_at = ? WHERE id = ?`).run(
          doneAt,
          params.reportId
        );
        return;
      } catch (err) {
        lastError = err;
        if (attempt < maxAttempts && isTransientError(err)) {
          await new Promise((r) => setTimeout(r, 1200 * attempt));
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  } catch (err) {
    const failAt = new Date().toISOString();
    const safeMsg = sanitizePublicError(err);
    db.prepare(
      `UPDATE processing_jobs SET status = 'failed', error_message = ?, completed_at = ?, updated_at = ? WHERE id = ?`
    ).run(safeMsg, failAt, failAt, jobId);
    db.prepare(`UPDATE medical_reports SET status = 'failed', updated_at = ? WHERE id = ?`).run(
      failAt,
      params.reportId
    );
    db.prepare(`UPDATE analyses SET error_message = ?, updated_at = ? WHERE id = ?`).run(
      safeMsg,
      failAt,
      params.analysisId
    );
  } finally {
    activeJobs.delete(jobId);
  }
}

function saveXRayResult(params: EnqueueJobParams, result: XRayAnalysisOutput): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE analyses
     SET model_name = ?, summary_plain = ?, structured_json = ?, limitations = ?, disclaimer = ?, urgent_flag = ?, urgent_reason = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    config.geminiModel,
    result.summaryPlainLanguage,
    JSON.stringify(result),
    result.technicalLimitations.join(' | '),
    result.safetyDisclaimer,
    result.urgentFlag ? 1 : 0,
    result.urgentReason || '',
    now,
    params.analysisId
  );
  db.prepare(`UPDATE medical_reports SET urgent_flag = ?, updated_at = ? WHERE id = ?`).run(
    result.urgentFlag ? 1 : 0,
    now,
    params.reportId
  );
}

function saveMRIResult(params: EnqueueJobParams, result: MRIAnalysisOutput): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE analyses
     SET model_name = ?, summary_plain = ?, structured_json = ?, limitations = ?, disclaimer = ?, urgent_flag = ?, urgent_reason = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    config.geminiModel,
    result.summaryPlainLanguage,
    JSON.stringify(result),
    `${result.singleSliceLimitationNote} | ${result.technicalLimitations.join(' | ')}`,
    result.safetyDisclaimer,
    result.urgentFlag ? 1 : 0,
    result.urgentReason || '',
    now,
    params.analysisId
  );
  db.prepare(`UPDATE medical_reports SET urgent_flag = ?, updated_at = ? WHERE id = ?`).run(
    result.urgentFlag ? 1 : 0,
    now,
    params.reportId
  );
}

function saveBloodResult(
  params: EnqueueJobParams,
  result: BloodReportAnalysisOutput,
  extractedText: string
): void {
  const db = getDb();
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE analyses
       SET model_name = ?, summary_plain = ?, structured_json = ?, extracted_text = ?, limitations = ?, disclaimer = ?, urgent_flag = ?, urgent_reason = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      config.geminiModel,
      result.overallSummary,
      JSON.stringify(result),
      extractedText.slice(0, 50000),
      result.limitations.join(' | '),
      result.safetyDisclaimer,
      result.urgentFlag ? 1 : 0,
      result.urgentReason || '',
      now,
      params.analysisId
    );

    db.prepare(`DELETE FROM blood_test_results WHERE analysis_id = ?`).run(params.analysisId);

    const insertMarker = db.prepare(
      `INSERT INTO blood_test_results (
        id, analysis_id, report_id, user_id, test_name, measured_value, numeric_value,
        unit, reference_range, ref_min, ref_max, status, simple_explanation, extraction_confidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const item of result.tests) {
      insertMarker.run(
        crypto.randomUUID(),
        params.analysisId,
        params.reportId,
        params.userId,
        item.testName,
        item.measuredValue,
        item.numericValue,
        item.unit || '',
        item.referenceRange || 'Unknown',
        item.refMin,
        item.refMax,
        item.status,
        item.simpleExplanation,
        item.extractionConfidence,
        now
      );
    }

    db.prepare(`UPDATE medical_reports SET urgent_flag = ?, updated_at = ? WHERE id = ?`).run(
      result.urgentFlag ? 1 : 0,
      now,
      params.reportId
    );
  });

  tx();
}

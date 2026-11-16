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
  fileId: string;
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
        timer = setTimeout(
          () => reject(new Error('Analysis timed out while waiting for AI response.')),
          timeoutMs
        );
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
    return 'The configured AI API key was rejected or lacks permission. Please verify GEMINI_API_KEY in environment settings.';
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
    return 'AI service rate limit reached. Please wait a moment and try again.';
  }
  return msg.slice(0, 400);
}

async function loadMedicalFileBuffer(params: EnqueueJobParams): Promise<Buffer> {
  if (params.filePath && fs.existsSync(params.filePath)) {
    return fs.readFileSync(params.filePath);
  }

  const db = await getDb();
  const row = await db.queryOne<{ file_data: Buffer | Uint8Array | null }>(
    'SELECT file_data FROM uploaded_files WHERE id = ? AND user_id = ?',
    [params.fileId, params.userId]
  );

  if (row?.file_data) {
    return Buffer.isBuffer(row.file_data) ? row.file_data : Buffer.from(row.file_data);
  }

  throw new Error('Source medical file is no longer available in private storage.');
}

export async function enqueueAnalysisJob(
  params: EnqueueJobParams
): Promise<{ jobId: string; status: string }> {
  const db = await getDb();
  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.execute(
    `INSERT INTO processing_jobs (id, report_id, analysis_id, user_id, job_type, status, attempts, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', 0, '', ?, ?)`,
    [jobId, params.reportId, params.analysisId, params.userId, params.jobType, now, now]
  );

  await db.execute(`UPDATE medical_reports SET status = 'queued', updated_at = ? WHERE id = ?`, [
    now,
    params.reportId,
  ]);

  // On Vercel serverless, background setImmediate work is frozen once the HTTP response ends.
  // Execute the analysis job inline before returning when running in a serverless runtime.
  if (config.isServerless) {
    await processJob(jobId, params);
    const updated = await db.queryOne<{ status: string }>(
      'SELECT status FROM processing_jobs WHERE id = ?',
      [jobId]
    );
    return { jobId, status: updated?.status || 'completed' };
  }

  // On persistent Node servers (AI Studio preview / Render / Docker), run asynchronously
  setImmediate(() => {
    void processJob(jobId, params);
  });

  return { jobId, status: 'queued' };
}

export async function processJob(jobId: string, params: EnqueueJobParams): Promise<void> {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);

  const db = await getDb();
  const maxAttempts = 2;

  try {
    const existingJob = await db.queryOne<{ status: string }>(
      'SELECT status FROM processing_jobs WHERE id = ?',
      [jobId]
    );
    if (!existingJob || existingJob.status === 'completed') return;

    const startTime = new Date().toISOString();
    await db.execute(
      `UPDATE processing_jobs SET status = 'processing', started_at = ?, updated_at = ? WHERE id = ?`,
      [startTime, startTime, jobId]
    );
    await db.execute(`UPDATE medical_reports SET status = 'processing', updated_at = ? WHERE id = ?`, [
      startTime,
      params.reportId,
    ]);

    const fileBuffer = await loadMedicalFileBuffer(params);
    const ai = getAIProvider();
    const aiTimeoutMs = config.isServerless ? 45000 : 90000;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await db.execute('UPDATE processing_jobs SET attempts = ?, updated_at = ? WHERE id = ?', [
        attempt,
        new Date().toISOString(),
        jobId,
      ]);

      try {
        if (params.jobType === 'xray') {
          const result: XRayAnalysisOutput = await withTimeout(
            ai.analyzeXRay({
              buffer: fileBuffer,
              mimeType: params.mimeType,
              clinicalNotes: params.clinicalNotes,
            }),
            aiTimeoutMs
          );
          await saveXRayResult(params, result);
        } else if (params.jobType === 'mri') {
          const result: MRIAnalysisOutput = await withTimeout(
            ai.analyzeMRI({
              buffer: fileBuffer,
              mimeType: params.mimeType,
              clinicalNotes: params.clinicalNotes,
            }),
            aiTimeoutMs
          );
          await saveMRIResult(params, result);
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
            aiTimeoutMs
          );
          await saveBloodResult(params, result, extractedText);
        }

        const doneAt = new Date().toISOString();
        await db.execute(
          `UPDATE processing_jobs SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?`,
          [doneAt, doneAt, jobId]
        );
        await db.execute(`UPDATE medical_reports SET status = 'completed', updated_at = ? WHERE id = ?`, [
          doneAt,
          params.reportId,
        ]);
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
    await db.execute(
      `UPDATE processing_jobs SET status = 'failed', error_message = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
      [safeMsg, failAt, failAt, jobId]
    );
    await db.execute(`UPDATE medical_reports SET status = 'failed', updated_at = ? WHERE id = ?`, [
      failAt,
      params.reportId,
    ]);
    await db.execute(`UPDATE analyses SET error_message = ?, updated_at = ? WHERE id = ?`, [
      safeMsg,
      failAt,
      params.analysisId,
    ]);
  } finally {
    activeJobs.delete(jobId);
  }
}

async function saveXRayResult(params: EnqueueJobParams, result: XRayAnalysisOutput): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE analyses
     SET model_name = ?, summary_plain = ?, structured_json = ?, limitations = ?, disclaimer = ?, urgent_flag = ?, urgent_reason = ?, updated_at = ?
     WHERE id = ?`,
    [
      config.geminiModel,
      result.summaryPlainLanguage,
      JSON.stringify(result),
      result.technicalLimitations.join(' | '),
      result.safetyDisclaimer,
      result.urgentFlag ? 1 : 0,
      result.urgentReason || '',
      now,
      params.analysisId,
    ]
  );
  await db.execute(`UPDATE medical_reports SET urgent_flag = ?, updated_at = ? WHERE id = ?`, [
    result.urgentFlag ? 1 : 0,
    now,
    params.reportId,
  ]);
}

async function saveMRIResult(params: EnqueueJobParams, result: MRIAnalysisOutput): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE analyses
     SET model_name = ?, summary_plain = ?, structured_json = ?, limitations = ?, disclaimer = ?, urgent_flag = ?, urgent_reason = ?, updated_at = ?
     WHERE id = ?`,
    [
      config.geminiModel,
      result.summaryPlainLanguage,
      JSON.stringify(result),
      `${result.singleSliceLimitationNote} | ${result.technicalLimitations.join(' | ')}`,
      result.safetyDisclaimer,
      result.urgentFlag ? 1 : 0,
      result.urgentReason || '',
      now,
      params.analysisId,
    ]
  );
  await db.execute(`UPDATE medical_reports SET urgent_flag = ?, updated_at = ? WHERE id = ?`, [
    result.urgentFlag ? 1 : 0,
    now,
    params.reportId,
  ]);
}

async function saveBloodResult(
  params: EnqueueJobParams,
  result: BloodReportAnalysisOutput,
  extractedText: string
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(
      `UPDATE analyses
       SET model_name = ?, summary_plain = ?, structured_json = ?, extracted_text = ?, limitations = ?, disclaimer = ?, urgent_flag = ?, urgent_reason = ?, updated_at = ?
       WHERE id = ?`,
      [
        config.geminiModel,
        result.overallSummary,
        JSON.stringify(result),
        extractedText.slice(0, 50000),
        result.limitations.join(' | '),
        result.safetyDisclaimer,
        result.urgentFlag ? 1 : 0,
        result.urgentReason || '',
        now,
        params.analysisId,
      ]
    );

    await tx.execute(`DELETE FROM blood_test_results WHERE analysis_id = ?`, [params.analysisId]);

    for (let idx = 0; idx < result.tests.length; idx++) {
      const item = result.tests[idx];
      await tx.execute(
        `INSERT INTO blood_test_results (
          id, analysis_id, report_id, user_id, test_name, measured_value, numeric_value,
          unit, reference_range, ref_min, ref_max, status, simple_explanation, extraction_confidence, sort_order, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
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
          idx,
          now,
        ]
      );
    }

    await tx.execute(`UPDATE medical_reports SET urgent_flag = ?, updated_at = ? WHERE id = ?`, [
      result.urgentFlag ? 1 : 0,
      now,
      params.reportId,
    ]);
  });
}

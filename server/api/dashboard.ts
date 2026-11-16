import { Router, type Response } from 'express';
import { getDb } from '../core/database.ts';
import {
  asyncHandler,
  logAudit,
  requireAuth,
  signFileAccessToken,
  type AuthRequest,
} from '../core/security.ts';
import { deletePrivateFile } from '../services/fileValidation.ts';

export const dashboardRouter = Router();
export const historyRouter = Router();

// GET /api/v1/dashboard/summary
dashboardRouter.get(
  '/summary',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.authUser!.id;
    const db = await getDb();

    const counts = await db.queryOne<{
      totalReports: number | string | null;
      xrayCount: number | string | null;
      mriCount: number | string | null;
      bloodCount: number | string | null;
      urgentCount: number | string | null;
      completedCount: number | string | null;
    }>(
      `SELECT
         COUNT(*) as "totalReports",
         SUM(CASE WHEN report_type = 'xray' THEN 1 ELSE 0 END) as "xrayCount",
         SUM(CASE WHEN report_type = 'mri' THEN 1 ELSE 0 END) as "mriCount",
         SUM(CASE WHEN report_type = 'blood' THEN 1 ELSE 0 END) as "bloodCount",
         SUM(CASE WHEN urgent_flag = 1 THEN 1 ELSE 0 END) as "urgentCount",
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as "completedCount"
       FROM medical_reports
       WHERE user_id = ?`,
      [userId]
    );

    const recentReports = await db.queryAll<{
      reportId: string;
      analysisId: string | null;
      reportType: string;
      title: string;
      status: string;
      urgentFlag: number;
      createdAt: string;
      summaryPlain: string | null;
    }>(
      `SELECT r.id as "reportId", a.id as "analysisId", r.report_type as "reportType", r.title,
              r.status, r.urgent_flag as "urgentFlag", r.created_at as "createdAt",
              a.summary_plain as "summaryPlain"
       FROM medical_reports r
       LEFT JOIN analyses a ON a.report_id = r.id
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC
       LIMIT 6`,
      [userId]
    );

    const bloodDistributionRaw = await db.queryAll<{ status: string; count: number | string }>(
      `SELECT status, COUNT(*) as count
       FROM blood_test_results
       WHERE user_id = ?
       GROUP BY status`,
      [userId]
    );

    res.json({
      metrics: {
        totalReports: Number(counts?.totalReports || 0),
        xrayCount: Number(counts?.xrayCount || 0),
        mriCount: Number(counts?.mriCount || 0),
        bloodCount: Number(counts?.bloodCount || 0),
        urgentCount: Number(counts?.urgentCount || 0),
        completedCount: Number(counts?.completedCount || 0),
      },
      recentReports: recentReports.map((r) => ({
        ...r,
        urgentFlag: Boolean(r.urgentFlag),
      })),
      bloodDistribution: bloodDistributionRaw.map((b) => ({
        status: b.status,
        count: Number(b.count || 0),
      })),
    });
  })
);

// GET /api/v1/history
historyRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.authUser!.id;
    const typeFilter = typeof req.query.type === 'string' ? req.query.type.toLowerCase() : 'all';
    const search = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const db = await getDb();

    let sql = `
      SELECT r.id as "reportId", a.id as "analysisId", r.report_type as "reportType", r.title,
             r.clinical_notes as "clinicalNotes", r.status, r.urgent_flag as "urgentFlag",
             r.created_at as "createdAt", r.updated_at as "updatedAt",
             a.summary_plain as "summaryPlain", f.original_filename as "originalFilename"
      FROM medical_reports r
      LEFT JOIN analyses a ON a.report_id = r.id
      LEFT JOIN uploaded_files f ON f.report_id = r.id
      WHERE r.user_id = ?
    `;
    const params: unknown[] = [userId];

    if (['xray', 'mri', 'blood'].includes(typeFilter)) {
      sql += ' AND r.report_type = ?';
      params.push(typeFilter);
    }
    if (search) {
      sql += " AND (LOWER(r.title) LIKE ? OR LOWER(COALESCE(a.summary_plain, '')) LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY r.created_at DESC';

    const rows = await db.queryAll<{
      reportId: string;
      analysisId: string | null;
      reportType: string;
      title: string;
      clinicalNotes: string;
      status: string;
      urgentFlag: number;
      createdAt: string;
      updatedAt: string;
      summaryPlain: string | null;
      originalFilename: string | null;
    }>(sql, params);

    res.json({
      items: rows.map((row) => ({
        ...row,
        urgentFlag: Boolean(row.urgentFlag),
      })),
    });
  })
);

// GET /api/v1/history/:reportId
historyRouter.get(
  '/:reportId',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.authUser!.id;
    const reportId = String(req.params.reportId || '');
    const db = await getDb();

    const row = await db.queryOne<{
      reportId: string;
      user_id: string;
      reportType: string;
      title: string;
      clinicalNotes: string;
      status: string;
      urgentFlag: number;
      createdAt: string;
      updatedAt: string;
      analysisId: string | null;
      modelName: string | null;
      summaryPlain: string | null;
      structuredJson: string | null;
      limitations: string | null;
      disclaimer: string | null;
      urgentReason: string | null;
      errorMessage: string | null;
      fileId: string | null;
      originalFilename: string | null;
      mimeType: string | null;
      fileSize: number | null;
    }>(
      `SELECT r.id as "reportId", r.user_id, r.report_type as "reportType", r.title, r.clinical_notes as "clinicalNotes",
              r.status, r.urgent_flag as "urgentFlag", r.created_at as "createdAt", r.updated_at as "updatedAt",
              a.id as "analysisId", a.model_name as "modelName", a.summary_plain as "summaryPlain",
              a.structured_json as "structuredJson", a.limitations, a.disclaimer,
              a.urgent_reason as "urgentReason", a.error_message as "errorMessage",
              f.id as "fileId", f.original_filename as "originalFilename", f.mime_type as "mimeType", f.file_size as "fileSize"
       FROM medical_reports r
       LEFT JOIN analyses a ON a.report_id = r.id
       LEFT JOIN uploaded_files f ON f.report_id = r.id
       WHERE r.id = ?`,
      [reportId]
    );

    if (!row) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }
    if (row.user_id !== userId) {
      res.status(403).json({ error: 'Forbidden: you do not have access to this medical report.' });
      return;
    }

    let structured: unknown = {};
    try {
      structured = JSON.parse(row.structuredJson || '{}');
    } catch {
      structured = {};
    }

    const bloodResults =
      row.reportType === 'blood'
        ? await db.queryAll(
            `SELECT id, test_name, measured_value, numeric_value, unit, reference_range,
                    ref_min, ref_max, status, simple_explanation, extraction_confidence
             FROM blood_test_results
             WHERE report_id = ?
             ORDER BY sort_order ASC, id ASC`,
            [row.reportId]
          )
        : [];

    const previewToken = row.fileId ? signFileAccessToken(row.fileId, userId, 900) : null;

    res.json({
      reportId: row.reportId,
      analysisId: row.analysisId,
      reportType: row.reportType,
      title: row.title,
      clinicalNotes: row.clinicalNotes,
      status: row.status,
      urgentFlag: Boolean(row.urgentFlag),
      urgentReason: row.urgentReason || '',
      modelName: row.modelName,
      summaryPlain: row.summaryPlain || '',
      structured,
      bloodResults,
      limitations: row.limitations || '',
      disclaimer: row.disclaimer || '',
      errorMessage: row.errorMessage || null,
      file: row.fileId
        ? {
            fileId: row.fileId,
            originalFilename: row.originalFilename,
            mimeType: row.mimeType,
            fileSize: row.fileSize,
            signedPreviewUrl: `/api/v1/uploads/${row.fileId}?token=${encodeURIComponent(previewToken!)}`,
          }
        : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  })
);

// DELETE /api/v1/history/:reportId
historyRouter.delete(
  '/:reportId',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.authUser!.id;
    const reportId = String(req.params.reportId || '');
    const db = await getDb();

    const report = await db.queryOne<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM medical_reports WHERE id = ?',
      [reportId]
    );

    if (!report) {
      res.status(404).json({ error: 'Medical report not found.' });
      return;
    }
    if (report.user_id !== userId) {
      res.status(403).json({ error: 'Forbidden: you cannot delete another user’s report.' });
      return;
    }

    const files = await db.queryAll<{ id: string; storage_path: string }>(
      'SELECT id, storage_path FROM uploaded_files WHERE report_id = ? AND user_id = ?',
      [reportId, userId]
    );

    for (const f of files) {
      deletePrivateFile(f.storage_path);
      await db.execute('DELETE FROM uploaded_files WHERE id = ?', [f.id]);
    }

    await db.execute('DELETE FROM medical_reports WHERE id = ? AND user_id = ?', [
      reportId,
      userId,
    ]);

    await logAudit({
      userId,
      requestId: req.requestId || 'req',
      action: 'REPORT_DELETED',
      resourceType: 'medical_report',
      resourceId: reportId,
      statusCode: 200,
      ipAddress: req.ip,
    });

    res.json({ message: 'Report and associated medical files deleted securely.' });
  })
);

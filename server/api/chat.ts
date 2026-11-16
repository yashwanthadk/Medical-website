import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import { getDb } from '../core/database.ts';
import {
  asyncHandler,
  createRateLimiter,
  DEFAULT_WORKSPACE_ID,
  logAudit,
  type WorkspaceRequest,
} from '../core/security.ts';
import { getAIProvider } from '../services/aiService.ts';

export const chatRouter = Router();
const chatLimiter = createRateLimiter(60_000, 30);

// POST /api/v1/chat/sessions
chatRouter.post(
  '/sessions',
  asyncHandler(async (req: WorkspaceRequest, res: Response) => {
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    const { reportId, title } = req.body ?? {};
    const db = await getDb();

    let linkedReportId: string | null = null;
    let defaultTitle = 'General Medical Report Q&A';

    if (typeof reportId === 'string' && reportId.trim()) {
      const report = await db.queryOne<{
        id: string;
        user_id: string;
        title: string;
        report_type: string;
      }>('SELECT id, user_id, title, report_type FROM medical_reports WHERE id = ?', [
        reportId.trim(),
      ]);

      if (!report) {
        res.status(404).json({ error: 'Selected medical report was not found.' });
        return;
      }
      if (report.user_id !== workspaceId) {
        res.status(403).json({ error: 'Forbidden: you do not have access to this report.' });
        return;
      }
      linkedReportId = report.id;
      defaultTitle = `${report.report_type.toUpperCase()}: ${report.title}`.slice(0, 140);
    }

    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();
    const cleanTitle =
      typeof title === 'string' && title.trim() ? title.trim().slice(0, 160) : defaultTitle;

    await db.execute(
      `INSERT INTO chat_sessions (id, user_id, report_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sessionId, workspaceId, linkedReportId, cleanTitle, now, now]
    );

    await logAudit({
      userId: workspaceId,
      requestId: req.requestId || 'req',
      action: 'CHAT_SESSION_CREATED',
      resourceType: 'chat_session',
      resourceId: sessionId,
      statusCode: 201,
      ipAddress: req.ip,
    });

    res.status(201).json({
      id: sessionId,
      reportId: linkedReportId,
      title: cleanTitle,
      createdAt: now,
      updatedAt: now,
    });
  })
);

// GET /api/v1/chat/sessions
chatRouter.get(
  '/sessions',
  asyncHandler(async (req: WorkspaceRequest, res: Response) => {
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    const db = await getDb();

    const rows = await db.queryAll(
      `SELECT s.id, s.report_id as "reportId", s.title, s.created_at as "createdAt", s.updated_at as "updatedAt",
              r.title as "reportTitle", r.report_type as "reportType"
       FROM chat_sessions s
       LEFT JOIN medical_reports r ON r.id = s.report_id
       WHERE s.user_id = ?
       ORDER BY s.updated_at DESC`,
      [workspaceId]
    );

    res.json({ sessions: rows });
  })
);

// GET /api/v1/chat/sessions/:sessionId
chatRouter.get(
  '/sessions/:sessionId',
  asyncHandler(async (req: WorkspaceRequest, res: Response) => {
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    const sessionId = String(req.params.sessionId || '');
    const db = await getDb();

    const session = await db.queryOne<{
      id: string;
      user_id: string;
      reportId: string | null;
      title: string;
      createdAt: string;
      updatedAt: string;
      reportTitle: string | null;
      reportType: string | null;
    }>(
      `SELECT s.id, s.user_id, s.report_id as "reportId", s.title, s.created_at as "createdAt", s.updated_at as "updatedAt",
              r.title as "reportTitle", r.report_type as "reportType"
       FROM chat_sessions s
       LEFT JOIN medical_reports r ON r.id = s.report_id
       WHERE s.id = ?`,
      [sessionId]
    );

    if (!session) {
      res.status(404).json({ error: 'Chat session not found.' });
      return;
    }
    if (session.user_id !== workspaceId) {
      res.status(403).json({ error: 'Forbidden: you do not have access to this chat session.' });
      return;
    }

    const messages = await db.queryAll(
      `SELECT id, role, content, created_at as "createdAt"
       FROM chat_messages
       WHERE session_id = ? AND user_id = ?
       ORDER BY created_at ASC`,
      [sessionId, workspaceId]
    );

    res.json({
      session: {
        id: session.id,
        reportId: session.reportId,
        reportTitle: session.reportTitle,
        reportType: session.reportType,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
      messages,
    });
  })
);

// POST /api/v1/chat/sessions/:sessionId/messages
chatRouter.post(
  '/sessions/:sessionId/messages',
  chatLimiter,
  asyncHandler(async (req: WorkspaceRequest, res: Response) => {
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    const sessionId = String(req.params.sessionId || '');
    const { message } = req.body ?? {};

    const cleanMessage = typeof message === 'string' ? message.trim() : '';
    if (!cleanMessage || cleanMessage.length > 4000) {
      res.status(400).json({ error: 'Please enter a question between 1 and 4000 characters.' });
      return;
    }

    const db = await getDb();
    const session = await db.queryOne<{
      id: string;
      user_id: string;
      report_id: string | null;
    }>('SELECT id, user_id, report_id FROM chat_sessions WHERE id = ?', [sessionId]);

    if (!session) {
      res.status(404).json({ error: 'Chat session not found.' });
      return;
    }
    if (session.user_id !== workspaceId) {
      res.status(403).json({ error: 'Forbidden: you do not have access to this chat session.' });
      return;
    }

    let reportContextText = '';
    if (session.report_id) {
      const reportData = await db.queryOne<{
        report_type: string;
        title: string;
        clinical_notes: string;
        summary_plain: string | null;
        structured_json: string | null;
        limitations: string | null;
      }>(
        `SELECT r.report_type, r.title, r.clinical_notes, a.summary_plain, a.structured_json, a.limitations
         FROM medical_reports r
         LEFT JOIN analyses a ON a.report_id = r.id
         WHERE r.id = ? AND r.user_id = ?`,
        [session.report_id, workspaceId]
      );

      if (reportData) {
        const bloodMarkers =
          reportData.report_type === 'blood'
            ? await db.queryAll<{
                test_name: string;
                measured_value: string;
                unit: string;
                reference_range: string;
                status: string;
              }>(
                `SELECT test_name, measured_value, unit, reference_range, status
                 FROM blood_test_results WHERE report_id = ? AND user_id = ?
                 ORDER BY sort_order ASC, id ASC`,
                [session.report_id, workspaceId]
              )
            : [];

        reportContextText = [
          `Report Type: ${reportData.report_type.toUpperCase()}`,
          `Title: ${reportData.title}`,
          reportData.clinical_notes ? `User Notes: ${reportData.clinical_notes}` : '',
          reportData.summary_plain ? `AI Summary: ${reportData.summary_plain}` : '',
          bloodMarkers.length
            ? `Extracted Blood Markers:\n${bloodMarkers
                .map(
                  (m) =>
                    `- ${m.test_name}: ${m.measured_value} ${m.unit} (Reference: ${m.reference_range}) [Status: ${m.status}]`
                )
                .join('\n')}`
            : `Structured Observations:\n${(reportData.structured_json || '').slice(0, 6000)}`,
          reportData.limitations ? `Known Limitations: ${reportData.limitations}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');
      }
    }

    const previousMessages = await db.queryAll<{
      role: 'user' | 'assistant';
      content: string;
    }>(
      `SELECT role, content FROM chat_messages
       WHERE session_id = ? AND user_id = ?
       ORDER BY created_at ASC`,
      [sessionId, workspaceId]
    );

    const userMsgId = crypto.randomUUID();
    const userMsgTime = new Date().toISOString();
    await db.execute(
      `INSERT INTO chat_messages (id, session_id, user_id, role, content, created_at)
       VALUES (?, ?, ?, 'user', ?, ?)`,
      [userMsgId, sessionId, workspaceId, cleanMessage, userMsgTime]
    );

    try {
      const reply = await getAIProvider().generateChatReply({
        reportContextText,
        history: previousMessages,
        userMessage: cleanMessage,
      });

      const assistantMsgId = crypto.randomUUID();
      const assistantMsgTime = new Date().toISOString();

      await db.execute(
        `INSERT INTO chat_messages (id, session_id, user_id, role, content, created_at)
         VALUES (?, ?, ?, 'assistant', ?, ?)`,
        [assistantMsgId, sessionId, workspaceId, reply, assistantMsgTime]
      );

      await db.execute('UPDATE chat_sessions SET updated_at = ? WHERE id = ?', [
        assistantMsgTime,
        sessionId,
      ]);

      res.status(201).json({
        userMessage: {
          id: userMsgId,
          role: 'user',
          content: cleanMessage,
          createdAt: userMsgTime,
        },
        assistantMessage: {
          id: assistantMsgId,
          role: 'assistant',
          content: reply,
          createdAt: assistantMsgTime,
        },
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Unable to reach AI medical chat service right now.';
      res.status(502).json({ error: msg });
    }
  })
);

// DELETE /api/v1/chat/sessions/:sessionId
chatRouter.delete(
  '/sessions/:sessionId',
  asyncHandler(async (req: WorkspaceRequest, res: Response) => {
    const workspaceId = req.workspaceId || DEFAULT_WORKSPACE_ID;
    const sessionId = String(req.params.sessionId || '');
    const db = await getDb();

    const session = await db.queryOne<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM chat_sessions WHERE id = ?',
      [sessionId]
    );

    if (!session) {
      res.status(404).json({ error: 'Chat session not found.' });
      return;
    }
    if (session.user_id !== workspaceId) {
      res.status(403).json({ error: 'Forbidden: you cannot delete another workspace’s chat session.' });
      return;
    }

    await db.execute('DELETE FROM chat_sessions WHERE id = ? AND user_id = ?', [
      sessionId,
      workspaceId,
    ]);

    await logAudit({
      userId: workspaceId,
      requestId: req.requestId || 'req',
      action: 'CHAT_SESSION_DELETED',
      resourceType: 'chat_session',
      resourceId: sessionId,
      statusCode: 200,
      ipAddress: req.ip,
    });

    res.json({ message: 'Chat session deleted.' });
  })
);

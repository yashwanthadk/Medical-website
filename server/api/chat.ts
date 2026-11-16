import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import { getDb } from '../core/database.ts';
import { createRateLimiter, logAudit, requireAuth, type AuthRequest } from '../core/security.ts';
import { getAIProvider } from '../services/aiService.ts';

export const chatRouter = Router();
const chatLimiter = createRateLimiter(60_000, 30);

// POST /api/v1/chat/sessions
chatRouter.post('/sessions', requireAuth, (req: AuthRequest, res: Response) => {
  const userId = req.authUser!.id;
  const { reportId, title } = req.body ?? {};
  const db = getDb();

  let linkedReportId: string | null = null;
  let defaultTitle = 'General Medical Report Q&A';

  if (typeof reportId === 'string' && reportId.trim()) {
    const report = db
      .prepare('SELECT id, user_id, title, report_type FROM medical_reports WHERE id = ?')
      .get(reportId.trim()) as
      | { id: string; user_id: string; title: string; report_type: string }
      | undefined;

    if (!report) {
      res.status(404).json({ error: 'Selected medical report was not found.' });
      return;
    }
    if (report.user_id !== userId) {
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

  db.prepare(
    `INSERT INTO chat_sessions (id, user_id, report_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sessionId, userId, linkedReportId, cleanTitle, now, now);

  logAudit({
    userId,
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
});

// GET /api/v1/chat/sessions
chatRouter.get('/sessions', requireAuth, (req: AuthRequest, res: Response) => {
  const userId = req.authUser!.id;
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT s.id, s.report_id as reportId, s.title, s.created_at as createdAt, s.updated_at as updatedAt,
              r.title as reportTitle, r.report_type as reportType
       FROM chat_sessions s
       LEFT JOIN medical_reports r ON r.id = s.report_id
       WHERE s.user_id = ?
       ORDER BY s.updated_at DESC`
    )
    .all(userId);

  res.json({ sessions: rows });
});

// GET /api/v1/chat/sessions/:sessionId
chatRouter.get('/sessions/:sessionId', requireAuth, (req: AuthRequest, res: Response) => {
  const userId = req.authUser!.id;
  const { sessionId } = req.params;
  const db = getDb();

  const session = db
    .prepare(
      `SELECT s.id, s.user_id, s.report_id as reportId, s.title, s.created_at as createdAt, s.updated_at as updatedAt,
              r.title as reportTitle, r.report_type as reportType
       FROM chat_sessions s
       LEFT JOIN medical_reports r ON r.id = s.report_id
       WHERE s.id = ?`
    )
    .get(sessionId) as
    | {
        id: string;
        user_id: string;
        reportId: string | null;
        title: string;
        createdAt: string;
        updatedAt: string;
        reportTitle: string | null;
        reportType: string | null;
      }
    | undefined;

  if (!session) {
    res.status(404).json({ error: 'Chat session not found.' });
    return;
  }
  if (session.user_id !== userId) {
    res.status(403).json({ error: 'Forbidden: you do not have access to this chat session.' });
    return;
  }

  const messages = db
    .prepare(
      `SELECT id, role, content, created_at as createdAt
       FROM chat_messages
       WHERE session_id = ? AND user_id = ?
       ORDER BY created_at ASC`
    )
    .all(sessionId, userId);

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
});

// POST /api/v1/chat/sessions/:sessionId/messages
chatRouter.post(
  '/sessions/:sessionId/messages',
  requireAuth,
  chatLimiter,
  async (req: AuthRequest, res: Response) => {
    const userId = req.authUser!.id;
    const { sessionId } = req.params;
    const { message } = req.body ?? {};

    const cleanMessage = typeof message === 'string' ? message.trim() : '';
    if (!cleanMessage || cleanMessage.length > 4000) {
      res.status(400).json({ error: 'Please enter a question between 1 and 4000 characters.' });
      return;
    }

    const db = getDb();
    const session = db
      .prepare('SELECT id, user_id, report_id FROM chat_sessions WHERE id = ?')
      .get(sessionId) as { id: string; user_id: string; report_id: string | null } | undefined;

    if (!session) {
      res.status(404).json({ error: 'Chat session not found.' });
      return;
    }
    if (session.user_id !== userId) {
      res.status(403).json({ error: 'Forbidden: you do not have access to this chat session.' });
      return;
    }

    // Build grounded context exclusively from this user's linked report
    let reportContextText = '';
    if (session.report_id) {
      const reportData = db
        .prepare(
          `SELECT r.report_type, r.title, r.clinical_notes, a.summary_plain, a.structured_json, a.limitations
           FROM medical_reports r
           LEFT JOIN analyses a ON a.report_id = r.id
           WHERE r.id = ? AND r.user_id = ?`
        )
        .get(session.report_id, userId) as
        | {
            report_type: string;
            title: string;
            clinical_notes: string;
            summary_plain: string | null;
            structured_json: string | null;
            limitations: string | null;
          }
        | undefined;

      if (reportData) {
        const bloodMarkers =
          reportData.report_type === 'blood'
            ? (db
                .prepare(
                  `SELECT test_name, measured_value, unit, reference_range, status
                   FROM blood_test_results WHERE report_id = ? AND user_id = ?`
                )
                .all(session.report_id, userId) as Array<{
                test_name: string;
                measured_value: string;
                unit: string;
                reference_range: string;
                status: string;
              }>)
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

    const previousMessages = db
      .prepare(
        `SELECT role, content FROM chat_messages
         WHERE session_id = ? AND user_id = ?
         ORDER BY created_at ASC`
      )
      .all(sessionId, userId) as Array<{ role: 'user' | 'assistant'; content: string }>;

    const userMsgId = crypto.randomUUID();
    const userMsgTime = new Date().toISOString();
    db.prepare(
      `INSERT INTO chat_messages (id, session_id, user_id, role, content, created_at)
       VALUES (?, ?, ?, 'user', ?, ?)`
    ).run(userMsgId, sessionId, userId, cleanMessage, userMsgTime);

    try {
      const reply = await getAIProvider().generateChatReply({
        reportContextText,
        history: previousMessages,
        userMessage: cleanMessage,
      });

      const assistantMsgId = crypto.randomUUID();
      const assistantMsgTime = new Date().toISOString();

      db.prepare(
        `INSERT INTO chat_messages (id, session_id, user_id, role, content, created_at)
         VALUES (?, ?, ?, 'assistant', ?, ?)`
      ).run(assistantMsgId, sessionId, userId, reply, assistantMsgTime);

      db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(
        assistantMsgTime,
        sessionId
      );

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
  }
);

// DELETE /api/v1/chat/sessions/:sessionId
chatRouter.delete('/sessions/:sessionId', requireAuth, (req: AuthRequest, res: Response) => {
  const userId = req.authUser!.id;
  const { sessionId } = req.params;
  const db = getDb();

  const session = db
    .prepare('SELECT id, user_id FROM chat_sessions WHERE id = ?')
    .get(sessionId) as { id: string; user_id: string } | undefined;

  if (!session) {
    res.status(404).json({ error: 'Chat session not found.' });
    return;
  }
  if (session.user_id !== userId) {
    res.status(403).json({ error: 'Forbidden: you cannot delete another user’s chat session.' });
    return;
  }

  db.prepare('DELETE FROM chat_sessions WHERE id = ? AND user_id = ?').run(sessionId, userId);

  logAudit({
    userId,
    requestId: req.requestId || 'req',
    action: 'CHAT_SESSION_DELETED',
    resourceType: 'chat_session',
    resourceId: sessionId,
    statusCode: 200,
    ipAddress: req.ip,
  });

  res.json({ message: 'Chat session deleted.' });
});

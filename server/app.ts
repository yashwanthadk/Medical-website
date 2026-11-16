import crypto from 'node:crypto';
import express, { type NextFunction, type Response } from 'express';
import { config } from './core/config.ts';
import { getDb } from './core/database.ts';
import type { AuthRequest } from './core/security.ts';
import { authRouter } from './api/auth.ts';
import { uploadsRouter } from './api/uploads.ts';
import { analysisRouter } from './api/analysis.ts';
import { dashboardRouter, historyRouter } from './api/dashboard.ts';
import { chatRouter } from './api/chat.ts';

export function createApiApp(): express.Express {
  const app = express();

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false }));

  // Attach request ID and security headers
  app.use((req: AuthRequest, res: Response, next: NextFunction) => {
    req.requestId = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Health and Readiness probes
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'MediExplain AI' });
  });

  app.get('/ready', (_req, res) => {
    try {
      const db = getDb();
      db.prepare('SELECT 1').get();
      res.json({
        status: 'ready',
        database: 'connected',
        aiConfigured: Boolean(
          (process.env.GEMINI_API_KEY || config.geminiApiKey) &&
            (process.env.GEMINI_API_KEY || config.geminiApiKey) !== 'MY_GEMINI_API_KEY'
        ),
      });
    } catch {
      res.status(503).json({ status: 'unavailable', database: 'disconnected' });
    }
  });

  // API v1 Routes
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/uploads', uploadsRouter);
  app.use('/api/v1/analysis', analysisRouter);
  app.use('/api/v1/dashboard', dashboardRouter);
  app.use('/api/v1/history', historyRouter);
  app.use('/api/v1/chat', chatRouter);

  // API 404 handler
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Global sanitized error handler (never leaks stack traces or sensitive data)
  app.use((err: unknown, _req: AuthRequest, res: Response, _next: NextFunction) => {
    console.error('Unhandled server error:', err instanceof Error ? err.message : 'Unknown error');
    res.status(500).json({ error: 'An unexpected server error occurred. Please try again.' });
  });

  return app;
}

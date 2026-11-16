import crypto from 'node:crypto';
import express, { type NextFunction, type Response } from 'express';
import { config } from './core/config.ts';
import { getDb, getPersistenceMode } from './core/database.ts';
import { attachWorkspace, type WorkspaceRequest } from './core/security.ts';
import { uploadsRouter } from './api/uploads.ts';
import { analysisRouter } from './api/analysis.ts';
import { dashboardRouter, historyRouter } from './api/dashboard.ts';
import { chatRouter } from './api/chat.ts';

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  const configured = [process.env.APP_URL, process.env.CORS_ORIGIN]
    .filter((v): v is string => Boolean(v && v.trim()))
    .map((v) => v.trim().replace(/\/+$/, ''));

  if (configured.includes(origin)) return true;

  try {
    const parsed = new URL(origin);
    if (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname.endsWith('.vercel.app')
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

export function createApiApp(): express.Express {
  const app = express();

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false }));

  // Attach request ID, CORS, and security headers
  app.use((req: WorkspaceRequest, res: Response, next: NextFunction) => {
    req.requestId = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
    if (origin && isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Request-Id, X-Workspace-Id'
      );
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  });

  app.use(attachWorkspace);

  // Health and Readiness probes
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'MediExplain AI' });
  });

  app.get('/ready', async (_req, res) => {
    try {
      const db = await getDb();
      await db.queryOne('SELECT 1 AS ok');
      res.json({
        status: 'ready',
        database: 'connected',
        persistenceMode: getPersistenceMode(),
        serverless: config.isServerless,
        aiConfigured: Boolean(
          (process.env.GEMINI_API_KEY || config.geminiApiKey) &&
            (process.env.GEMINI_API_KEY || config.geminiApiKey) !== 'MY_GEMINI_API_KEY'
        ),
      });
    } catch {
      res.status(503).json({ status: 'unavailable', database: 'disconnected' });
    }
  });

  // API v1 Routes (publicly accessible without authentication)
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
  app.use((err: unknown, _req: WorkspaceRequest, res: Response, _next: NextFunction) => {
    console.error('Unhandled server error:', err instanceof Error ? err.message : 'Unknown error');
    res.status(500).json({ error: 'An unexpected server error occurred. Please try again.' });
  });

  return app;
}

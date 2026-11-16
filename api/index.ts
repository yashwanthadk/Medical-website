import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApiApp } from '../server/app.ts';
import { ensureDbReady } from '../server/core/database.ts';

const app = createApiApp();

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await ensureDbReady();

  if (req.url) {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      const vercelPath = parsed.searchParams.get('__vercel_path');
      if (vercelPath) {
        parsed.searchParams.delete('__vercel_path');
        const qs = parsed.searchParams.toString();
        const normalizedPath = vercelPath.startsWith('/') ? vercelPath : `/${vercelPath}`;
        req.url = qs ? `${normalizedPath}?${qs}` : normalizedPath;
      }
    } catch {
      // Keep original req.url if URL parsing fails
    }
  }

  return app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { config } from './server/core/config.ts';
import { getDb } from './server/core/database.ts';
import { createApiApp } from './server/app.ts';

async function startServer() {
  // Initialize SQLite database schema on startup
  getDb();

  const app = createApiApp();

  if (config.nodeEnv !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Production bundle not built.');
      }
    });
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`MediExplain AI server listening on http://0.0.0.0:${config.port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start MediExplain AI server:', err);
  process.exit(1);
});

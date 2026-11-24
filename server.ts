import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { handleApiWithCloudflareWorker } from './server/viteWorkerMiddleware';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProd = process.env.NODE_ENV === 'production';

// Delegate all /api/* requests directly to worker.ts with the local SQLite D1 development storage adapter
app.use('/api', (req, res) => {
  // Restore full originalUrl on req.url so worker.ts receives '/api/...'
  req.url = req.originalUrl;
  void handleApiWithCloudflareWorker(req, res);
});

async function startServer() {
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[Science of Gifts Feed Optimizer] AI Studio Preview Server (routing /api/* -> worker.ts + D1 SQLite adapter) running at http://localhost:${PORT}`
    );
  });
}

startServer();

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';
import { handleApiWithCloudflareWorker } from './server/viteWorkerMiddleware';

function cloudflareWorkerPreviewPlugin(): Plugin {
  return {
    name: 'science-of-gifts-cloudflare-worker-preview',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/api' || req.url?.startsWith('/api/') || req.url?.startsWith('/api?')) {
          void handleApiWithCloudflareWorker(req, res, next);
          return;
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/api' || req.url?.startsWith('/api/') || req.url?.startsWith('/api?')) {
          void handleApiWithCloudflareWorker(req, res, next);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), cloudflareWorkerPreviewPlugin()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

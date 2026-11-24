import type { IncomingMessage, ServerResponse } from 'http';
import worker, { Env } from '../worker';
import { getInitializedDevD1Database, devStorageCallbacks } from './devD1Adapter';

async function readNodeRequestBody(req: IncomingMessage): Promise<Buffer> {
  // If Express json/raw middleware already parsed or buffered body, handle gracefully
  if ((req as any).rawBody && Buffer.isBuffer((req as any).rawBody)) {
    return (req as any).rawBody;
  }
  if (
    (req as any).body &&
    typeof (req as any).body === 'object' &&
    Object.keys((req as any).body).length > 0
  ) {
    return Buffer.from(JSON.stringify((req as any).body), 'utf-8');
  }

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      reject(err);
    });
  });
}

export async function buildDevelopmentWorkerEnv(): Promise<Env> {
  const db = await getInitializedDevD1Database();
  return {
    DB: db,
    ENVIRONMENT: 'development',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
    CF_ACCESS_TEAM_DOMAIN: process.env.CF_ACCESS_TEAM_DOMAIN || '',
    CF_ACCESS_AUD: process.env.CF_ACCESS_AUD || '',
    ADMIN_API_TOKEN: process.env.ADMIN_API_TOKEN || '',
    REQUIRE_AUTH: process.env.REQUIRE_AUTH || 'false',
    __DEV_STORAGE_CALLBACKS__: devStorageCallbacks,
  };
}

/**
 * Node HTTP / Connect middleware that invokes `worker.ts` locally for `/api/*` requests
 * using the isolated development SQLite D1 storage adapter (`data/dev-d1.sqlite`).
 */
export async function handleApiWithCloudflareWorker(
  req: IncomingMessage,
  res: ServerResponse,
  next?: (err?: any) => void
): Promise<boolean> {
  const rawUrl = req.url || '/';
  if (rawUrl !== '/api' && !rawUrl.startsWith('/api/') && !rawUrl.startsWith('/api?')) {
    if (next) next();
    return false;
  }

  try {
    const host = req.headers.host || 'localhost:3000';
    const protoHeader = req.headers['x-forwarded-proto'];
    const protocol =
      typeof protoHeader === 'string' && protoHeader.trim()
        ? protoHeader.split(',')[0].trim()
        : 'http';
    const fullUrl = `${protocol}://${host}${rawUrl}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else {
        headers.set(key, value);
      }
    }

    const method = (req.method || 'GET').toUpperCase();
    let bodyInit: Uint8Array | undefined = undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const bodyBuf = await readNodeRequestBody(req);
      if (bodyBuf.byteLength > 0) {
        bodyInit = new Uint8Array(bodyBuf);
      }
    }

    const webRequest = new Request(fullUrl, {
      method,
      headers,
      body: bodyInit,
    });

    const devEnv = await buildDevelopmentWorkerEnv();
    const webResponse = await worker.fetch(webRequest, devEnv);

    res.statusCode = webResponse.status;
    webResponse.headers.forEach((val, key) => {
      res.setHeader(key, val);
    });

    const arrayBuf = await webResponse.arrayBuffer();
    res.end(Buffer.from(arrayBuf));
    return true;
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        success: false,
        error: err?.message || 'Local Worker middleware failed',
      })
    );
    return true;
  }
}

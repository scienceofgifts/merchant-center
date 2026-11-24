import { D1Database, D1CatalogStorage } from './server/d1Storage';
import { setWorkerGeminiApiKey, hasConfiguredGeminiApiKey } from './server/gemini';
import { extractProductFromUrl } from './server/extractor';
import {
  generateProductStrategy,
  generateOptimizedFields,
  performAIAudit,
  runGranularAIOperation,
  optimizeAndApplyAll,
  fixSingleAuditIssue,
  fixAllSafeAuditIssues,
  inferProductGroupAndSubgroup,
  computeFieldProvenance,
} from './server/aiStrategist';
import { computeProductStatus } from './src/utils/validation';
import { reconcileProductAttributes } from './src/utils/attributeReconciler';
import {
  generateMerchantCenterCsv,
  generateMerchantCenterRssXml,
  parseCsvText,
  previewCsvCatalogImport,
  applyCsvCatalogImport,
} from './src/utils/csv';
import {
  APPROVED_WEBSITE_FEED_URL,
  fetchWebsiteFeedXml,
  parseMerchantCenterRssXml,
  previewWebsiteFeedSync,
  applyWebsiteFeedSync,
  FeedFetchOptions,
} from './server/websiteFeedSync';
import { ProductItem, MerchantData, FeedSyncApplyOptions, CsvImportMode } from './src/types/feed';

export interface AssetsFetcher {
  fetch(request: Request | string): Promise<Response>;
}

export interface Env {
  DB?: D1Database;
  ASSETS?: AssetsFetcher;
  GEMINI_API_KEY?: string;
  ENVIRONMENT?: 'production' | 'development' | 'test' | string;
  /**
   * Cloudflare Access Team Domain (e.g. "scienceofgifts.cloudflareaccess.com" or "scienceofgifts")
   * and Application Audience (AUD) tag for Zero Trust JWT verification.
   */
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  /**
   * Optional shared secret bearer token for automated scripts or backup API authentication.
   */
  ADMIN_API_TOKEN?: string;
  /**
   * If set to "true", enforces authentication even in non-production environments.
   */
  REQUIRE_AUTH?: string;
  /**
   * Optional internal callbacks used only by the local AI Studio development adapter.
   */
  __DEV_STORAGE_CALLBACKS__?: {
    onDevSyncCallback?: (items: ProductItem[]) => void;
    onDevStrategySyncCallback?: (config: any) => void;
  };
  /**
   * Optional custom feed fetch options for isolated testing.
   */
  __TEST_FEED_FETCH_OPTIONS__?: FeedFetchOptions;
}

const MAX_REQUEST_BODY_BYTES = 25 * 1024 * 1024; // 25 MB request payload ceiling
const MAX_CSV_IMPORT_BYTES = 20 * 1024 * 1024; // 20 MB CSV ceiling
const MAX_CSV_IMPORT_ROWS = 25000;
const ALLOWED_CSV_IMPORT_MODES = new Set<CsvImportMode>(['merge', 'update', 'replace']);
const ALLOWED_FEED_SYNC_MODES = new Set(['add_only', 'sync_factual']);

const utf8Encoder = new TextEncoder();

function getUtf8ByteLength(str: string): number {
  return utf8Encoder.encode(str).byteLength;
}

function jsonResponse(data: unknown, status: number = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      ...extraHeaders,
    },
  });
}

function timingSafeEqualString(a: string, b: string): boolean {
  const aBytes = utf8Encoder.encode(a);
  const bBytes = utf8Encoder.encode(b);
  if (aBytes.byteLength !== bBytes.byteLength) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBytes.byteLength; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(padLen);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Cache Cloudflare Access public keys briefly in isolate memory
const jwksCache = new Map<string, { expiresAt: number; keys: any[] }>();

async function verifyCloudflareAccessJwt(
  token: string,
  teamDomain: string,
  expectedAud: string
): Promise<{ valid: boolean; email?: string; reason?: string }> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, reason: 'Malformed Cloudflare Access JWT' };
    }

    const headerJson = new TextDecoder().decode(base64UrlToUint8Array(parts[0]));
    const payloadJson = new TextDecoder().decode(base64UrlToUint8Array(parts[1]));
    const header = JSON.parse(headerJson);
    const payload = JSON.parse(payloadJson);

    if (header.alg !== 'RS256' || !header.kid) {
      return { valid: false, reason: 'Unsupported JWT algorithm or missing kid' };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp < nowSec) {
      return { valid: false, reason: 'Cloudflare Access JWT has expired' };
    }
    if (typeof payload.nbf === 'number' && payload.nbf > nowSec + 60) {
      return { valid: false, reason: 'Cloudflare Access JWT is not yet valid' };
    }

    const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audList.includes(expectedAud)) {
      return { valid: false, reason: 'Cloudflare Access JWT audience (AUD) mismatch' };
    }

    const cleanDomain = teamDomain
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '');
    const fullTeamHost = cleanDomain.includes('.')
      ? cleanDomain
      : `${cleanDomain}.cloudflareaccess.com`;
    const certsUrl = `https://${fullTeamHost}/cdn-cgi/access/certs`;

    let keys: any[] = [];
    const cached = jwksCache.get(certsUrl);
    if (cached && cached.expiresAt > Date.now()) {
      keys = cached.keys;
    } else {
      const res = await fetch(certsUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        return { valid: false, reason: `Unable to fetch Cloudflare Access certs (HTTP ${res.status})` };
      }
      const jwks: any = await res.json();
      keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
      jwksCache.set(certsUrl, { expiresAt: Date.now() + 5 * 60 * 1000, keys });
    }

    const matchingJwk = keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
    if (!matchingJwk) {
      return { valid: false, reason: 'No matching JWK found for Cloudflare Access token' };
    }

    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      matchingJwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signedData = utf8Encoder.encode(`${parts[0]}.${parts[1]}`);
    const signature = base64UrlToUint8Array(parts[2]);
    const isValidSig = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      signature,
      signedData
    );

    if (!isValidSig) {
      return { valid: false, reason: 'Invalid Cloudflare Access JWT signature' };
    }

    return { valid: true, email: typeof payload.email === 'string' ? payload.email : undefined };
  } catch (err: any) {
    return { valid: false, reason: err?.message || 'Cloudflare Access JWT verification failed' };
  }
}

/**
 * Enforces authentication and same-origin protection on `/api/*` endpoints.
 * - Blocks cross-origin mutation requests (CSRF / unauthorized CORS defense).
 * - When Cloudflare Access (`CF_ACCESS_AUD` + `CF_ACCESS_TEAM_DOMAIN`) or `ADMIN_API_TOKEN` is configured,
 *   or when `REQUIRE_AUTH === 'true'`, verifies every API request before granting catalog access.
 */
async function verifyApiSecurity(
  request: Request,
  env: Env
): Promise<{ allowed: boolean; response?: Response }> {
  const method = request.method.toUpperCase();
  const requestUrl = new URL(request.url);

  // 1. Same-Origin enforcement on state-changing requests
  if (method !== 'GET' && method !== 'HEAD') {
    const originHeader = request.headers.get('Origin');
    if (originHeader) {
      try {
        const originUrl = new URL(originHeader);
        if (originUrl.host !== requestUrl.host) {
          return {
            allowed: false,
            response: jsonResponse(
              {
                success: false,
                error: `Cross-origin mutation request from "${originUrl.origin}" is forbidden.`,
              },
              403
            ),
          };
        }
      } catch {
        return {
          allowed: false,
          response: jsonResponse({ success: false, error: 'Invalid Origin header.' }, 403),
        };
      }
    }
  }

  // 2. Authentication verification (Cloudflare Access Zero Trust JWT and/or Admin API Token)
  const cfAccessAud = (env.CF_ACCESS_AUD || '').trim();
  const cfAccessTeamDomain = (env.CF_ACCESS_TEAM_DOMAIN || '').trim();
  const adminApiToken = (env.ADMIN_API_TOKEN || '').trim();
  const requireAuth = env.REQUIRE_AUTH === 'true';

  const hasAuthConfigured = Boolean(cfAccessAud || adminApiToken);

  if (!hasAuthConfigured && !requireAuth) {
    return { allowed: true };
  }

  // Check Admin Bearer Token first if provided
  if (adminApiToken) {
    const authHeader = request.headers.get('Authorization') || '';
    const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const xAdminToken = (request.headers.get('X-Admin-Token') || '').trim();
    const candidateToken = bearerToken || xAdminToken;

    if (candidateToken && timingSafeEqualString(candidateToken, adminApiToken)) {
      return { allowed: true };
    }
  }

  // Check Cloudflare Access JWT assertion header
  if (cfAccessAud) {
    const cfJwt = (request.headers.get('Cf-Access-Jwt-Assertion') || '').trim();
    if (cfJwt && cfAccessTeamDomain) {
      const verification = await verifyCloudflareAccessJwt(cfJwt, cfAccessTeamDomain, cfAccessAud);
      if (verification.valid) {
        return { allowed: true };
      }
      return {
        allowed: false,
        response: jsonResponse(
          {
            success: false,
            error: `Authentication failed: ${verification.reason || 'Invalid Cloudflare Access token'}.`,
          },
          401
        ),
      };
    }

    if (cfJwt && !cfAccessTeamDomain) {
      return {
        allowed: false,
        response: jsonResponse(
          {
            success: false,
            error:
              'Server authentication configuration incomplete: CF_ACCESS_TEAM_DOMAIN must be set alongside CF_ACCESS_AUD.',
          },
          500
        ),
      };
    }
  }

  return {
    allowed: false,
    response: jsonResponse(
      {
        success: false,
        error:
          'Authentication required. Protect this application with Cloudflare Access or provide a valid Authorization bearer token.',
      },
      401
    ),
  };
}

async function parseJsonBody<T = any>(request: Request): Promise<T> {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength) {
    const bytes = parseInt(contentLength, 10);
    if (!isNaN(bytes) && bytes > MAX_REQUEST_BODY_BYTES) {
      throw new Error(`Request body size (${bytes} bytes) exceeds maximum limit of ${MAX_REQUEST_BODY_BYTES} bytes.`);
    }
  }

  const rawText = await request.text();
  if (getUtf8ByteLength(rawText) > MAX_REQUEST_BODY_BYTES) {
    throw new Error(`Request body exceeds maximum limit of ${MAX_REQUEST_BODY_BYTES} bytes.`);
  }
  if (!rawText.trim()) {
    return {} as T;
  }
  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new Error('Malformed JSON request body.');
  }
}

function validateCsvImportPayload(body: any): {
  error?: string;
  csvText?: string;
  mode?: CsvImportMode;
} {
  const rawCsvText = body?.csvText;
  if (typeof rawCsvText !== 'string' || rawCsvText.trim().length === 0) {
    return { error: 'CSV content missing' };
  }
  if (getUtf8ByteLength(rawCsvText) > MAX_CSV_IMPORT_BYTES) {
    return { error: 'CSV file exceeds the 20MB import limit' };
  }

  const rawMode = body?.mode;
  let mode: CsvImportMode = 'merge';
  if (rawMode !== undefined && rawMode !== null && rawMode !== '') {
    if (typeof rawMode !== 'string' || !ALLOWED_CSV_IMPORT_MODES.has(rawMode as CsvImportMode)) {
      return { error: 'Invalid import mode. Allowed values: merge, update, replace.' };
    }
    mode = rawMode as CsvImportMode;
  }

  const parsedRows = parseCsvText(rawCsvText);
  if (parsedRows.length === 0) {
    return { error: 'Could not parse CSV or file is empty' };
  }
  if (parsedRows.length > MAX_CSV_IMPORT_ROWS) {
    return { error: `CSV exceeds maximum supported row count (${MAX_CSV_IMPORT_ROWS} rows)` };
  }

  return { csvText: rawCsvText, mode };
}

function sanitizeStringArray(val: unknown): string[] | undefined {
  if (val === undefined) return undefined;
  if (!Array.isArray(val)) return undefined;
  return val.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function sanitizeManualMappings(val: unknown): Record<string, string> {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (
      k !== '__proto__' &&
      k !== 'constructor' &&
      k !== 'prototype' &&
      typeof k === 'string' &&
      typeof v === 'string' &&
      k.trim() &&
      v.trim()
    ) {
      result[k] = v.trim();
    }
  }
  return result;
}

/**
 * Resolves the D1CatalogStorage engine for the current Worker request.
 * Production strictly requires `env.DB` (Cloudflare D1) and NEVER falls back to volatile or browser storage.
 */
function resolveD1Storage(env: Env): D1CatalogStorage {
  if (!env || !env.DB) {
    const isDev = env?.ENVIRONMENT === 'development' || env?.ENVIRONMENT === 'test';
    const message = isDev
      ? 'Development D1 storage binding (env.DB) is not initialized. Ensure the Vite development storage adapter is mounted.'
      : 'Production storage error: Cloudflare D1 database binding (env.DB) is missing. Configure d1_databases with binding "DB" in wrangler.jsonc.';
    const err = new Error(message);
    (err as any).statusCode = 503;
    throw err;
  }

  return new D1CatalogStorage(env.DB, env.__DEV_STORAGE_CALLBACKS__);
}

async function handleApiRequest(request: Request, env: Env, url: URL): Promise<Response> {
  // Inject Worker GEMINI_API_KEY secret for server-side AI operations
  setWorkerGeminiApiKey(env.GEMINI_API_KEY);

  // Verify same-origin & authentication rules
  const securityCheck = await verifyApiSecurity(request, env);
  if (!securityCheck.allowed && securityCheck.response) {
    return securityCheck.response;
  }

  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  try {
    const storage = resolveD1Storage(env);

    // 0. Health & Storage Diagnostics Endpoint
    if (method === 'GET' && pathname === '/api/health') {
      const catalog = await storage.loadCatalog();
      return jsonResponse({
        success: true,
        storageBackend: 'cloudflare-d1',
        environment: env.ENVIRONMENT || 'production',
        productCount: catalog.length,
        geminiKeyConfigured: hasConfiguredGeminiApiKey(),
        authConfigured: Boolean(env.CF_ACCESS_AUD || env.ADMIN_API_TOKEN || env.REQUIRE_AUTH === 'true'),
      });
    }

    // 1. Catalog Products CRUD
    if (method === 'GET' && pathname === '/api/products') {
      const catalog = await storage.loadCatalog();
      return jsonResponse({ success: true, count: catalog.length, products: catalog });
    }

    if (method === 'POST' && pathname === '/api/products') {
      const newProduct = await parseJsonBody<ProductItem>(request);
      if (!newProduct || typeof newProduct.id !== 'string' || !newProduct.id.trim()) {
        return jsonResponse({ success: false, error: 'Valid product ID is required' }, 400);
      }

      const catalog = await storage.loadCatalog();
      const existingIndex = catalog.findIndex((p) => p.id === newProduct.id);

      const now = new Date().toISOString();
      newProduct.updatedAt = now;
      if (!newProduct.createdAt) newProduct.createdAt = now;

      if (existingIndex >= 0) {
        catalog[existingIndex] = newProduct;
      } else {
        catalog.unshift(newProduct);
      }

      const { status, validation } = computeProductStatus(newProduct, catalog);
      newProduct.status = status;
      newProduct.validation = validation;

      await storage.saveCatalog(catalog);
      return jsonResponse({ success: true, product: newProduct });
    }

    // 2. Batch URL Extraction
    if (method === 'POST' && pathname === '/api/products/batch-extract') {
      const body = await parseJsonBody<{ urls?: string[] }>(request);
      const urls: string[] = body.urls || [];
      if (!Array.isArray(urls) || urls.length === 0) {
        return jsonResponse({ success: false, error: 'No URLs provided' }, 400);
      }

      const catalog = await storage.loadCatalog();
      const results: Array<{ url: string; success: boolean; product?: ProductItem; error?: string }> = [];

      for (const rawUrl of urls) {
        const targetUrl = typeof rawUrl === 'string' ? rawUrl.trim() : '';
        if (!targetUrl) continue;
        try {
          const extracted = await extractProductFromUrl(targetUrl);
          const idx = catalog.findIndex(
            (p) => p.id === extracted.id || p.merchantData.link === targetUrl
          );
          if (idx >= 0) {
            const existing = catalog[idx];
            const mergedMerchantData: MerchantData = {
              ...existing.merchantData,
              ...extracted.merchantData,
              id: existing.id,
              link: existing.merchantData.link,
              color: extracted.merchantData.color || existing.merchantData.color || '',
              size: extracted.merchantData.size || existing.merchantData.size || '',
              material: extracted.merchantData.material || existing.merchantData.material || '',
              gtin: extracted.merchantData.gtin || existing.merchantData.gtin || '',
              mpn: extracted.merchantData.mpn || existing.merchantData.mpn || '',
            };

            const mergedProduct: ProductItem = {
              ...existing,
              ...extracted,
              id: existing.id,
              merchantData: mergedMerchantData,
              evidence: {
                ...existing.evidence,
                ...extracted.evidence,
                userCorrections: existing.evidence?.userCorrections || {},
              },
              history: [
                {
                  timestamp: new Date().toISOString(),
                  note: 'Re-extracted from URL (preserved existing attributes and ID)',
                  snapshot: { ...existing.merchantData },
                },
                ...(existing.history || []),
              ],
              updatedAt: new Date().toISOString(),
            };

            catalog[idx] = mergedProduct;
            results.push({ url: targetUrl, success: true, product: mergedProduct });
          } else {
            catalog.unshift(extracted);
            results.push({ url: targetUrl, success: true, product: extracted });
          }
        } catch (err: any) {
          results.push({ url: targetUrl, success: false, error: err?.message || 'Extraction failed' });
        }
      }

      await storage.saveCatalog(catalog);
      return jsonResponse({ success: true, results, count: results.length });
    }

    // 3. Batch Catalog Actions
    if (method === 'POST' && pathname === '/api/products/batch-action') {
      const body = await parseJsonBody<{ action?: string; ids?: string[] }>(request);
      const { action, ids } = body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return jsonResponse({ success: false, error: 'No product IDs provided' }, 400);
      }

      let catalog = await storage.loadCatalog();
      const config = await storage.loadStrategyConfig();
      const results: Array<{ id: string; success: boolean; error?: string }> = [];

      if (action === 'delete') {
        catalog = catalog.filter((p) => !ids.includes(p.id));
        await storage.saveCatalog(catalog);
        return jsonResponse({ success: true, count: ids.length });
      }

      for (const id of ids) {
        const item = catalog.find((p) => p.id === id);
        if (!item) {
          results.push({ id, success: false, error: 'Item not found' });
          continue;
        }

        try {
          if (
            action === 'generate_and_optimize' ||
            action === 'optimize_and_apply' ||
            action === 'optimize_apply'
          ) {
            await optimizeAndApplyAll(item, config);
          } else if (action === 'analyze' || action === 'optimize') {
            const strategy = await generateProductStrategy(item, config);
            item.strategy = strategy;
            const { suggestedMerchantData, suggestedGiftIntelligence, titleCandidates } =
              await generateOptimizedFields(item, strategy, config);
            item.suggestedMerchantData = suggestedMerchantData;
            item.suggestedGiftIntelligence = suggestedGiftIntelligence;
            item.titleCandidates = titleCandidates;
            if (titleCandidates.length > 0) item.selectedTitleCandidateId = titleCandidates[0].id;
          }

          if (action === 'audit') {
            const audit = await performAIAudit(item, config);
            item.audit = audit;
          }

          if (action === 'approve_all') {
            if (item.suggestedMerchantData) {
              item.history.unshift({
                timestamp: new Date().toISOString(),
                note: 'Batch approved all suggestions',
                snapshot: { ...item.merchantData },
              });
              const priorMd = { ...item.merchantData };
              item.merchantData = { ...item.merchantData, ...item.suggestedMerchantData };
              item.suggestedMerchantData = undefined;
              const provResult = computeFieldProvenance(item, priorMd);
              item.fieldProvenance = provResult.fieldProvenance;
              item.fieldProvenanceDetails = provResult.fieldProvenanceDetails;
            }
            if (item.suggestedGiftIntelligence) {
              item.giftIntelligence = {
                ...item.giftIntelligence,
                ...item.suggestedGiftIntelligence,
              };
              item.suggestedGiftIntelligence = undefined;
            }
          }

          const { status, validation } = computeProductStatus(item, catalog);
          item.status = status;
          item.validation = validation;
          item.updatedAt = new Date().toISOString();
          results.push({ id, success: true });
        } catch (err: any) {
          results.push({ id, success: false, error: err?.message || 'Action failed' });
        }
      }

      await storage.saveCatalog(catalog);
      return jsonResponse({ success: true, results });
    }

    // 4. Refresh Attributes & Apply Refreshed Attributes
    const refreshMatch = pathname.match(/^\/api\/products\/refresh-attributes\/([^/]+)$/);
    if (method === 'POST' && refreshMatch) {
      const productId = decodeURIComponent(refreshMatch[1]);
      const catalog = await storage.loadCatalog();
      const item = catalog.find((p) => p.id === productId);
      if (!item) {
        return jsonResponse({ success: false, error: 'Product not found' }, 404);
      }

      const sourceUrl = item.evidence?.sourceUrl || item.merchantData.link;
      if (!sourceUrl) {
        return jsonResponse(
          { success: false, error: 'No source URL available for this product' },
          400
        );
      }

      const freshExtracted = await extractProductFromUrl(sourceUrl);
      const tempItem: ProductItem = {
        ...item,
        evidence: {
          ...item.evidence,
          ...freshExtracted.evidence,
          verifiedAttributes: {
            brand:
              item.evidence?.verifiedAttributes?.brand ||
              freshExtracted.evidence.verifiedAttributes?.brand,
            ...freshExtracted.evidence.verifiedAttributes,
          },
          variants:
            freshExtracted.evidence?.variants && freshExtracted.evidence.variants.length > 0
              ? freshExtracted.evidence.variants
              : item.evidence?.variants || [],
          rawDescription:
            freshExtracted.evidence?.rawDescription || item.evidence?.rawDescription || '',
          pageTitle: freshExtracted.evidence?.pageTitle || item.evidence?.pageTitle || '',
        },
      };

      const discrepancies = reconcileProductAttributes(tempItem);
      const attributesToRefresh = ['color', 'size', 'material'] as const;
      const preview = attributesToRefresh.map((field) => {
        const disc = discrepancies.find((d) => d.field === field);
        const currentValue = item.merchantData[field] || '';
        const proposedValue = disc?.proposedValue || currentValue;
        const status = disc?.status || 'supported';
        const evidenceSource = disc?.evidenceSource || 'Source extracted evidence';
        const reason = disc?.reason || 'Attribute matches verified evidence.';

        return {
          field,
          currentValue,
          proposedValue,
          status,
          evidenceSource,
          reason,
          isSupportedChange: status === 'contradicted' || (!currentValue && !!proposedValue),
        };
      });

      return jsonResponse({
        success: true,
        productId: item.id,
        sourceUrl,
        preview,
        freshEvidence: freshExtracted.evidence,
      });
    }

    const applyRefreshedMatch = pathname.match(
      /^\/api\/products\/apply-refreshed-attributes\/([^/]+)$/
    );
    if (method === 'POST' && applyRefreshedMatch) {
      const productId = decodeURIComponent(applyRefreshedMatch[1]);
      const catalog = await storage.loadCatalog();
      const index = catalog.findIndex((p) => p.id === productId);
      if (index === -1) {
        return jsonResponse({ success: false, error: 'Product not found' }, 404);
      }

      const body = await parseJsonBody<{ updates?: Record<string, string>; freshEvidence?: any }>(
        request
      );
      const { updates, freshEvidence } = body;
      if (!updates || typeof updates !== 'object') {
        return jsonResponse({ success: false, error: 'No attribute updates provided' }, 400);
      }

      const prev = catalog[index];
      const priorMerchantData = { ...prev.merchantData };
      const changedFields: string[] = [];
      const newMerchantData = { ...prev.merchantData };

      for (const field of ['color', 'size', 'material'] as const) {
        if (updates[field] !== undefined) {
          newMerchantData[field] = updates[field];
          if (updates[field] !== priorMerchantData[field]) {
            changedFields.push(field);
          }
        }
      }

      const history = [...(prev.history || [])];
      if (changedFields.length > 0) {
        history.unshift({
          timestamp: new Date().toISOString(),
          note: `Refreshed physical attributes: ${changedFields.join(', ')}`,
          snapshot: priorMerchantData,
        });
      }

      const updated: ProductItem = {
        ...prev,
        merchantData: newMerchantData,
        evidence: freshEvidence
          ? {
              ...prev.evidence,
              ...freshEvidence,
              userCorrections: {
                ...(prev.evidence?.userCorrections || {}),
                ...updates,
              },
            }
          : prev.evidence,
        history,
        updatedAt: new Date().toISOString(),
      };

      const provResult = computeFieldProvenance(updated, priorMerchantData);
      updated.fieldProvenance = provResult.fieldProvenance;
      updated.fieldProvenanceDetails = provResult.fieldProvenanceDetails;

      const { status, validation } = computeProductStatus(updated, catalog);
      updated.status = status;
      updated.validation = validation;

      catalog[index] = updated;
      await storage.saveCatalog(catalog);

      return jsonResponse({ success: true, product: updated, appliedFields: changedFields });
    }

    // Single Product GET / PUT / DELETE (/api/products/:id)
    const singleProductMatch = pathname.match(/^\/api\/products\/([^/]+)$/);
    if (singleProductMatch) {
      const productId = decodeURIComponent(singleProductMatch[1]);

      if (method === 'GET') {
        const catalog = await storage.loadCatalog();
        const item = catalog.find((p) => p.id === productId);
        if (!item) {
          return jsonResponse({ success: false, error: 'Product not found' }, 404);
        }
        return jsonResponse({ success: true, product: item });
      }

      if (method === 'PUT') {
        const catalog = await storage.loadCatalog();
        const index = catalog.findIndex((p) => p.id === productId);
        if (index === -1) {
          return jsonResponse({ success: false, error: 'Product not found' }, 404);
        }

        const body = await parseJsonBody<Partial<ProductItem>>(request);
        const prev = catalog[index];
        const incomingMd = (body.merchantData || {}) as Partial<MerchantData>;
        const userCorrections = { ...(prev.evidence?.userCorrections || {}) };
        const changedFields: string[] = [];

        for (const key of [
          'size',
          'color',
          'material',
          'title',
          'description',
          'google_product_category',
          'product_type',
        ] as const) {
          if (incomingMd[key] !== undefined && incomingMd[key] !== (prev.merchantData as any)[key]) {
            userCorrections[key] = incomingMd[key] as string;
            changedFields.push(key);
          }
        }

        const history = [...(prev.history || [])];
        if (changedFields.length > 0) {
          history.unshift({
            timestamp: new Date().toISOString(),
            note: `User manual edit: ${changedFields.join(', ')}`,
            snapshot: { ...prev.merchantData },
          });
        }

        const updated: ProductItem = {
          ...prev,
          ...body,
          id: prev.id,
          merchantData: {
            ...prev.merchantData,
            ...incomingMd,
            id: prev.id,
            link: prev.merchantData.link,
          },
          evidence: {
            ...prev.evidence,
            ...(body.evidence || {}),
            userCorrections,
          },
          history,
          updatedAt: new Date().toISOString(),
        };

        const provResult = computeFieldProvenance(updated, prev.merchantData);
        updated.fieldProvenance = provResult.fieldProvenance;
        updated.fieldProvenanceDetails = provResult.fieldProvenanceDetails;

        const { status, validation } = computeProductStatus(updated, catalog);
        updated.status = status;
        updated.validation = validation;

        catalog[index] = updated;
        await storage.saveCatalog(catalog);

        return jsonResponse({ success: true, product: updated });
      }

      if (method === 'DELETE') {
        await storage.deleteProduct(productId);
        return jsonResponse({ success: true, message: 'Product deleted' });
      }
    }

    // 5. AI Operations: Strategy, Full Optimization, Quality Audit, Granular
    const aiStrategyMatch = pathname.match(/^\/api\/ai\/strategy\/([^/]+)$/);
    if (method === 'POST' && aiStrategyMatch) {
      const productId = decodeURIComponent(aiStrategyMatch[1]);
      const catalog = await storage.loadCatalog();
      const config = await storage.loadStrategyConfig();
      const item = catalog.find((p) => p.id === productId);
      if (!item) {
        return jsonResponse({ success: false, error: 'Product not found' }, 404);
      }

      const body = await parseJsonBody<{ refresh?: boolean }>(request);
      const refresh = body.refresh === true;
      if (item.strategy && !refresh) {
        return jsonResponse({ success: true, strategy: item.strategy, cached: true });
      }

      const strategy = await generateProductStrategy(item, config);
      item.strategy = strategy;
      item.updatedAt = new Date().toISOString();

      const { status, validation } = computeProductStatus(item, catalog);
      item.status = status;
      item.validation = validation;

      await storage.saveCatalog(catalog);
      return jsonResponse({ success: true, strategy, cached: false });
    }

    const aiOptimizeMatch = pathname.match(/^\/api\/ai\/optimize\/([^/]+)$/);
    if (method === 'POST' && aiOptimizeMatch) {
      const productId = decodeURIComponent(aiOptimizeMatch[1]);
      const catalog = await storage.loadCatalog();
      const config = await storage.loadStrategyConfig();
      const item = catalog.find((p) => p.id === productId);
      if (!item) {
        return jsonResponse({ success: false, error: 'Product not found' }, 404);
      }

      let strategy = item.strategy;
      if (!strategy) {
        strategy = await generateProductStrategy(item, config);
        item.strategy = strategy;
      }

      const { suggestedMerchantData, suggestedGiftIntelligence, titleCandidates } =
        await generateOptimizedFields(item, strategy, config);

      item.suggestedMerchantData = suggestedMerchantData;
      item.suggestedGiftIntelligence = suggestedGiftIntelligence;
      item.titleCandidates = titleCandidates;
      if (titleCandidates.length > 0) {
        item.selectedTitleCandidateId = titleCandidates[0].id;
      }

      item.updatedAt = new Date().toISOString();
      const { status, validation } = computeProductStatus(item, catalog);
      item.status = status;
      item.validation = validation;

      await storage.saveCatalog(catalog);
      return jsonResponse({
        success: true,
        suggestedMerchantData,
        suggestedGiftIntelligence,
        titleCandidates,
      });
    }

    const aiGenOptimizeMatch = pathname.match(
      /^\/api\/ai\/(?:optimize-and-apply|generate-and-optimize)\/([^/]+)$/
    );
    if (method === 'POST' && aiGenOptimizeMatch) {
      const productId = decodeURIComponent(aiGenOptimizeMatch[1]);
      const catalog = await storage.loadCatalog();
      const config = await storage.loadStrategyConfig();
      const item = catalog.find((p) => p.id === productId);
      if (!item) {
        return jsonResponse({ success: false, error: 'Product not found' }, 404);
      }

      const result = await optimizeAndApplyAll(item, config);

      const { status, validation } = computeProductStatus(item, catalog);
      item.status = status;
      item.validation = validation;

      await storage.saveCatalog(catalog);
      return jsonResponse({
        success: true,
        product: item,
        beforeScore: result.beforeScore,
        afterScore: result.afterScore,
        appliedFields: result.appliedFields,
        autoFixedIssues: result.autoFixedIssues,
        remainingReviewCount: result.remainingReviewCount,
        generatedCount: result.generatedCount,
        optimizedCount: result.optimizedCount,
        verifiedCount: result.verifiedCount,
        fieldProvenance: item.fieldProvenance,
      });
    }

    const aiResetMatch = pathname.match(/^\/api\/ai\/reset-to-original\/([^/]+)$/);
    if (method === 'POST' && aiResetMatch) {
      const productId = decodeURIComponent(aiResetMatch[1]);
      const catalog = await storage.loadCatalog();
      const item = catalog.find((p) => p.id === productId);
      if (!item) {
        return jsonResponse({ success: false, error: 'Product not found' }, 404);
      }

      const original = item.originalImported || { ...item.merchantData };

      item.merchantData = {
        ...item.merchantData,
        ...original,
        color: item.evidence.verifiedAttributes?.color || original.color || '',
        size: item.evidence.verifiedAttributes?.size || original.size || '',
        material: item.evidence.verifiedAttributes?.material || original.material || '',
      };

      item.strategy = undefined;
      item.suggestedMerchantData = undefined;
      item.suggestedGiftIntelligence = undefined;
      item.titleCandidates = [];
      item.selectedTitleCandidateId = undefined;

      const inferred = inferProductGroupAndSubgroup(
        item.merchantData.title,
        item.merchantData.description,
        item.evidence.sourceUrl
      );
      item.productGroup = inferred.productGroup;
      item.productSubgroup = inferred.productSubgroup;

      item.updatedAt = new Date().toISOString();
      const { status, validation } = computeProductStatus(item, catalog);
      item.status = status;
      item.validation = validation;

      await storage.saveCatalog(catalog);
      return jsonResponse({
        success: true,
        product: item,
        message: 'Successfully restored original imported data and cleared stale AI cache.',
      });
    }

    const aiAuditMatch = pathname.match(/^\/api\/ai\/audit\/([^/]+)$/);
    if (method === 'POST' && aiAuditMatch) {
      const productId = decodeURIComponent(aiAuditMatch[1]);
      const catalog = await storage.loadCatalog();
      const config = await storage.loadStrategyConfig();
      const item = catalog.find((p) => p.id === productId);
      if (!item) {
        return jsonResponse({ success: false, error: 'Product not found' }, 404);
      }

      const audit = await performAIAudit(item, config);
      item.audit = audit;
      item.updatedAt = new Date().toISOString();

      const { status, validation } = computeProductStatus(item, catalog);
      item.status = status;
      item.validation = validation;

      await storage.saveCatalog(catalog);
      return jsonResponse({ success: true, audit });
    }

    const aiFixIssueMatch = pathname.match(/^\/api\/ai\/fix-issue\/([^/]+)$/);
    if (method === 'POST' && aiFixIssueMatch) {
      const productId = decodeURIComponent(aiFixIssueMatch[1]);
      const catalog = await storage.loadCatalog();
      const config = await storage.loadStrategyConfig();
      const item = catalog.find((p) => p.id === productId);
      if (!item) {
        return jsonResponse({ success: false, error: 'Product not found' }, 404);
      }

      const body = await parseJsonBody<{ issueId?: string }>(request);
      if (!body.issueId) {
        return jsonResponse({ success: false, error: 'Missing issueId parameter' }, 400);
      }

      const result = await fixSingleAuditIssue(item, body.issueId, config);

      const { status, validation } = computeProductStatus(item, catalog);
      item.status = status;
      item.validation = validation;

      await storage.saveCatalog(catalog);
      return jsonResponse({
        success: true,
        product: item,
        fixedIssue: result.fixedIssue,
        appliedChanges: result.appliedChanges,
        message: result.message,
      });
    }

    const aiFixAllSafeMatch = pathname.match(/^\/api\/ai\/fix-all-safe-issues\/([^/]+)$/);
    if (method === 'POST' && aiFixAllSafeMatch) {
      const productId = decodeURIComponent(aiFixAllSafeMatch[1]);
      const catalog = await storage.loadCatalog();
      const config = await storage.loadStrategyConfig();
      const item = catalog.find((p) => p.id === productId);
      if (!item) {
        return jsonResponse({ success: false, error: 'Product not found' }, 404);
      }

      const result = await fixAllSafeAuditIssues(item, config);

      const { status, validation } = computeProductStatus(item, catalog);
      item.status = status;
      item.validation = validation;

      await storage.saveCatalog(catalog);
      return jsonResponse({
        success: true,
        product: item,
        fixedCount: result.fixedCount,
        fixedList: result.fixedList,
        appliedChanges: result.appliedChanges,
      });
    }

    const aiGranularMatch = pathname.match(/^\/api\/ai\/granular\/([^/]+)$/);
    if (method === 'POST' && aiGranularMatch) {
      const productId = decodeURIComponent(aiGranularMatch[1]);
      const catalog = await storage.loadCatalog();
      const config = await storage.loadStrategyConfig();
      const item = catalog.find((p) => p.id === productId);
      if (!item) {
        return jsonResponse({ success: false, error: 'Product not found' }, 404);
      }

      const body = await parseJsonBody<{ operation?: any }>(request);
      const operation = body.operation;
      if (typeof operation === 'object' && operation?.type === 'fix_issue') {
        const result = await fixSingleAuditIssue(item, operation.issueId, config);
        const { status, validation } = computeProductStatus(item, catalog);
        item.status = status;
        item.validation = validation;
        await storage.saveCatalog(catalog);
        return jsonResponse({ success: true, product: item, result });
      }

      const result = await runGranularAIOperation(item, operation, config);

      if (result.suggestedMerchantData) {
        item.suggestedMerchantData = {
          ...item.suggestedMerchantData,
          ...result.suggestedMerchantData,
        };
      }
      if (result.suggestedGiftIntelligence) {
        item.suggestedGiftIntelligence = {
          ...item.suggestedGiftIntelligence,
          ...result.suggestedGiftIntelligence,
        };
      }
      if (result.titleCandidates && result.titleCandidates.length > 0) {
        item.titleCandidates = result.titleCandidates;
        item.selectedTitleCandidateId = result.titleCandidates[0].id;
      }

      item.updatedAt = new Date().toISOString();
      await storage.saveCatalog(catalog);
      return jsonResponse({ success: true, result });
    }

    const aiApplySuggestionsMatch = pathname.match(/^\/api\/ai\/apply-suggestions\/([^/]+)$/);
    if (method === 'POST' && aiApplySuggestionsMatch) {
      const productId = decodeURIComponent(aiApplySuggestionsMatch[1]);
      const catalog = await storage.loadCatalog();
      const item = catalog.find((p) => p.id === productId);
      if (!item) {
        return jsonResponse({ success: false, error: 'Product not found' }, 404);
      }

      const body = await parseJsonBody<{ fieldsToApply?: string[]; note?: string }>(request);
      const { fieldsToApply, note } = body;
      const now = new Date().toISOString();

      item.history.unshift({
        timestamp: now,
        note: note || `Applied AI suggestions: ${(fieldsToApply || ['all']).join(', ')}`,
        snapshot: { ...item.merchantData },
      });

      if (item.suggestedMerchantData) {
        if (!fieldsToApply || fieldsToApply.includes('all')) {
          item.merchantData = {
            ...item.merchantData,
            ...item.suggestedMerchantData,
          };
          item.suggestedMerchantData = undefined;
        } else {
          for (const field of fieldsToApply) {
            if ((item.suggestedMerchantData as any)[field] !== undefined) {
              (item.merchantData as any)[field] = (item.suggestedMerchantData as any)[field];
              delete (item.suggestedMerchantData as any)[field];
            }
          }
        }
      }

      if (item.suggestedGiftIntelligence) {
        item.giftIntelligence = {
          ...item.giftIntelligence,
          ...item.suggestedGiftIntelligence,
        };
        item.suggestedGiftIntelligence = undefined;
      }

      item.appliedSuggestions.push({
        timestamp: now,
        fields: fieldsToApply || ['all'],
        note: note || 'AI suggestions applied',
      });

      item.updatedAt = now;
      const { status, validation } = computeProductStatus(item, catalog);
      item.status = status;
      item.validation = validation;

      await storage.saveCatalog(catalog);
      return jsonResponse({ success: true, product: item });
    }

    // 6. Strategy Configuration Area
    if (pathname === '/api/strategy-config') {
      if (method === 'GET') {
        const config = await storage.loadStrategyConfig();
        return jsonResponse({ success: true, config });
      }
      if (method === 'PUT') {
        const config = await parseJsonBody(request);
        await storage.saveStrategyConfig(config);
        return jsonResponse({ success: true, config });
      }
    }

    // 7. CSV Import & Export
    if (method === 'POST' && pathname === '/api/import-csv/preview') {
      const body = await parseJsonBody(request);
      const validated = validateCsvImportPayload(body);
      if (validated.error || !validated.csvText || !validated.mode) {
        return jsonResponse(
          { success: false, error: validated.error || 'Invalid CSV payload' },
          400
        );
      }

      const catalog = await storage.loadCatalog();
      const preview = previewCsvCatalogImport(catalog, validated.csvText, validated.mode);
      return jsonResponse({ success: true, preview });
    }

    if (method === 'POST' && pathname === '/api/import-csv') {
      const body = await parseJsonBody(request);
      const validated = validateCsvImportPayload(body);
      if (validated.error || !validated.csvText || !validated.mode) {
        return jsonResponse(
          { success: false, error: validated.error || 'Invalid CSV payload' },
          400
        );
      }

      const { csvText, mode } = validated;
      const confirmed = body?.confirmed === true;

      if ((mode === 'update' || mode === 'replace') && !confirmed) {
        return jsonResponse(
          {
            success: false,
            error: `Mode "${mode}" requires previewing the import and explicitly confirming before applying.`,
          },
          400
        );
      }

      const catalog = await storage.loadCatalog();

      let backupPath: string | null = null;
      if (catalog.length > 0) {
        backupPath = await storage.createCatalogBackup(`pre-csv-${mode}`, catalog);
      }

      const { updatedCatalog, preview, summary } = applyCsvCatalogImport(catalog, csvText, mode);
      await storage.saveCatalog(updatedCatalog);

      return jsonResponse({
        success: true,
        count: summary.uniqueCsvProducts,
        catalogCount: updatedCatalog.length,
        summary,
        preview,
        backupPath,
      });
    }

    if (method === 'GET' && pathname === '/api/export-csv') {
      const catalog = await storage.loadCatalog();
      const csvData = generateMerchantCenterCsv(catalog);
      return new Response(csvData, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="science_of_gifts_merchant_feed.csv"',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    if (method === 'GET' && pathname === '/api/export-rss') {
      const catalog = await storage.loadCatalog();
      const rssXml = generateMerchantCenterRssXml(catalog);
      return new Response(rssXml, {
        status: 200,
        headers: {
          'Content-Type': 'application/rss+xml; charset=utf-8',
          'Content-Disposition': 'attachment; filename="science_of_gifts_merchant_feed.xml"',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    // 7b. Website Feed Sync (Read-Only Preview & Confirmed Apply)
    if (method === 'POST' && pathname === '/api/feed-sync/preview') {
      const body = await parseJsonBody(request);
      const rawFeedUrl = body?.feedUrl;
      const feedUrl =
        typeof rawFeedUrl === 'string' && rawFeedUrl.trim()
          ? rawFeedUrl.trim()
          : APPROVED_WEBSITE_FEED_URL;
      const manualMappings = sanitizeManualMappings(body?.manualMappings);

      const xmlText = await fetchWebsiteFeedXml(feedUrl, env.__TEST_FEED_FETCH_OPTIONS__);
      const feedVariants = parseMerchantCenterRssXml(xmlText);
      const catalog = await storage.loadCatalog();
      const preview = previewWebsiteFeedSync(catalog, feedVariants, feedUrl, manualMappings);
      return jsonResponse({ success: true, preview });
    }

    if (method === 'POST' && pathname === '/api/feed-sync/apply') {
      const body = await parseJsonBody(request);
      if (body?.confirmed !== true) {
        return jsonResponse(
          {
            success: false,
            error:
              'Explicit user confirmation (confirmed: true) is required before applying Website Feed Sync.',
          },
          400
        );
      }

      const rawFeedUrl = body?.feedUrl;
      const feedUrl =
        typeof rawFeedUrl === 'string' && rawFeedUrl.trim()
          ? rawFeedUrl.trim()
          : APPROVED_WEBSITE_FEED_URL;

      const rawOptions = body?.options && typeof body.options === 'object' ? body.options : {};
      const rawSyncMode = rawOptions.syncMode;
      let syncMode: 'add_only' | 'sync_factual' = 'add_only';
      if (rawSyncMode !== undefined && rawSyncMode !== null && rawSyncMode !== '') {
        if (typeof rawSyncMode !== 'string' || !ALLOWED_FEED_SYNC_MODES.has(rawSyncMode)) {
          return jsonResponse(
            {
              success: false,
              error: 'Invalid syncMode. Allowed values: add_only, sync_factual.',
            },
            400
          );
        }
        syncMode = rawSyncMode as 'add_only' | 'sync_factual';
      }

      const options: FeedSyncApplyOptions = {
        syncMode,
        approvedCatalogIds: sanitizeStringArray(rawOptions.approvedCatalogIds),
        manualMappings: sanitizeManualMappings(rawOptions.manualMappings),
        importUnmatchedFeedGroupKeys: sanitizeStringArray(
          rawOptions.importUnmatchedFeedGroupKeys
        ),
        overrideCustomTitleForIds: sanitizeStringArray(rawOptions.overrideCustomTitleForIds),
        overrideCustomDescriptionForIds: sanitizeStringArray(
          rawOptions.overrideCustomDescriptionForIds
        ),
      };

      const xmlText = await fetchWebsiteFeedXml(feedUrl, env.__TEST_FEED_FETCH_OPTIONS__);
      const feedVariants = parseMerchantCenterRssXml(xmlText);
      const catalog = await storage.loadCatalog();

      let backupPath: string | null = null;
      if (catalog.length > 0) {
        backupPath = await storage.createCatalogBackup('pre-website-feed-sync', catalog);
      }

      const { updatedCatalog, result } = applyWebsiteFeedSync(
        catalog,
        feedVariants,
        feedUrl,
        options
      );
      await storage.saveCatalog(updatedCatalog);

      return jsonResponse({
        success: true,
        result,
        backupPath,
        catalogCount: updatedCatalog.length,
      });
    }

    // 8. Full Backup & Restore
    if (method === 'GET' && pathname === '/api/backup') {
      const catalog = await storage.loadCatalog();
      const strategy = await storage.loadStrategyConfig();
      return jsonResponse(
        { catalog, strategy, exportedAt: new Date().toISOString() },
        200,
        {
          'Content-Disposition': 'attachment; filename="science_of_gifts_backup.json"',
        }
      );
    }

    if (method === 'POST' && pathname === '/api/restore') {
      const body = await parseJsonBody<{ catalog?: ProductItem[]; strategy?: any }>(request);
      const { catalog, strategy } = body;
      if (catalog && Array.isArray(catalog)) {
        await storage.saveCatalog(catalog);
      }
      if (strategy && typeof strategy === 'object') {
        await storage.saveStrategyConfig(strategy);
      }
      return jsonResponse({ success: true, message: 'Data restored successfully' });
    }

    return jsonResponse({ success: false, error: `API route not found: ${method} ${pathname}` }, 404);
  } catch (err: any) {
    const statusCode =
      typeof err?.statusCode === 'number'
        ? err.statusCode
        : pathname.startsWith('/api/feed-sync/')
          ? 400
          : 500;
    return jsonResponse(
      {
        success: false,
        error: err?.message || 'Internal Worker Error',
      },
      statusCode
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 1. Handle all /api/* routes directly inside the Cloudflare Worker
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env, url);
    }

    // 2. Delegate frontend static asset & SPA requests to Cloudflare Workers Static Assets (env.ASSETS)
    if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return new Response(
      'Static assets binding (env.ASSETS) is not configured. Ensure assets.binding is set to "ASSETS" in wrangler.jsonc.',
      {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }
    );
  },
};

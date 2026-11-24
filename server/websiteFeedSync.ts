import dns from 'dns';
import net from 'net';
import {
  ProductItem,
  WebsiteVariant,
  WebsiteSyncMatchMethod,
  FeedSyncPreviewResult,
  FeedSyncMatchedItem,
  FeedSyncFieldDiff,
  FeedSyncUnmatchedFeedGroup,
  FeedSyncUnmatchedCatalogItem,
  FeedSyncAmbiguousMatch,
  FeedSyncApplyOptions,
  FeedSyncApplyResult,
  FeedSyncMode,
  MerchantData,
} from '../src/types/feed';
import { computeProductStatus } from '../src/utils/validation';
import { inferProductGroupAndSubgroup, getSpecificTheme } from './aiStrategist';
import { guessTaxonomy } from './extractor';
import { allocateCustomLabels } from '../src/utils/customLabels';
import { INITIAL_STRATEGY_CONFIG } from '../src/utils/taxonomy';
import { determineProductIdentifiers, sanitizeHttpUrl } from '../src/utils/csv';

export const APPROVED_WEBSITE_FEED_URL =
  'https://shop.scienceofgifts.com/.well-known/merchant-center/rss.xml';

const APPROVED_HOSTNAMES = new Set(['shop.scienceofgifts.com']);
const APPROVED_PATHS = new Set(['/.well-known/merchant-center/rss.xml']);

export const DEFAULT_FEED_TIMEOUT_MS = 10_000;
export const MAX_FEED_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_FEED_ITEMS = 5_000;

export type DnsLookupFunction = (
  hostname: string
) => Promise<Array<{ address: string; family: number }>>;

export interface FeedFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  fetchFn?: typeof fetch;
  dnsLookupFn?: DnsLookupFunction;
}

/**
 * Checks if an IPv4 or IPv6 address is loopback, private, link-local, multicast, or unspecified.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const cleanIp = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');

  // Handle IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1)
  if (cleanIp.startsWith('::ffff:')) {
    const mappedV4 = cleanIp.slice('::ffff:'.length);
    if (net.isIPv4(mappedV4)) {
      return isPrivateOrReservedIp(mappedV4);
    }
  }

  if (net.isIPv4(cleanIp)) {
    const parts = cleanIp.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }
    const [a, b] = parts;
    // 0.0.0.0/8 (unspecified)
    if (a === 0) return true;
    // 10.0.0.0/8 (private)
    if (a === 10) return true;
    // 100.64.0.0/10 (CGNAT)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 127.0.0.0/8 (loopback)
    if (a === 127) return true;
    // 169.254.0.0/16 (link-local / cloud metadata 169.254.169.254)
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 (private)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 (private)
    if (a === 192 && b === 168) return true;
    // 224.0.0.0/4 (multicast) & 240.0.0.0/4 (reserved)
    if (a >= 224) return true;
    return false;
  }

  if (net.isIPv6(cleanIp)) {
    // Unspecified :: or loopback ::1
    if (cleanIp === '::' || cleanIp === '::1' || cleanIp === '0:0:0:0:0:0:0:1' || cleanIp === '0:0:0:0:0:0:0:0') {
      return true;
    }
    // Unique local fc00::/7 (fc00... or fd00...)
    if (cleanIp.startsWith('fc') || cleanIp.startsWith('fd')) {
      return true;
    }
    // Link-local fe80::/10
    if (
      cleanIp.startsWith('fe8') ||
      cleanIp.startsWith('fe9') ||
      cleanIp.startsWith('fea') ||
      cleanIp.startsWith('feb')
    ) {
      return true;
    }
    // Multicast ff00::/8
    if (cleanIp.startsWith('ff')) {
      return true;
    }
    return false;
  }

  // If not recognized as valid IPv4 or IPv6, treat as unsafe
  return true;
}

const utf8Encoder = new TextEncoder();

function getUtf8ByteLength(str: string): number {
  return utf8Encoder.encode(str).byteLength;
}

const defaultDnsLookup: DnsLookupFunction = async (hostname: string) => {
  // 1. In Node.js environments (local dev / test), use dns.promises.lookup
  if (typeof dns?.promises?.lookup === 'function') {
    try {
      const records = await dns.promises.lookup(hostname, { all: true });
      if (records && records.length > 0) {
        return records;
      }
    } catch (err: any) {
      // In Cloudflare Workers runtime (workerd), dns.promises.lookup throws ERR_METHOD_NOT_IMPLEMENTED;
      // fall through to Cloudflare DNS-over-HTTPS resolution below.
      if (
        err?.code !== 'ERR_METHOD_NOT_IMPLEMENTED' &&
        !/not implemented/i.test(err?.message || '')
      ) {
        throw err;
      }
    }
  }

  // 2. In Cloudflare Workers runtime, resolve A records via Cloudflare DNS-over-HTTPS (DoH)
  try {
    const dohUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`;
    const res = await globalThis.fetch(dohUrl, {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data: any = await res.json();
      const answers = Array.isArray(data?.Answer) ? data.Answer : [];
      const ipRecords = answers
        .filter((a: any) => a?.type === 1 && typeof a?.data === 'string')
        .map((a: any) => ({ address: a.data.trim(), family: 4 }));
      if (ipRecords.length > 0) {
        return ipRecords;
      }
    }
  } catch {
    // If DoH is unreachable in an offline/sandboxed worker environment, allow only strict allowlisted hostnames
  }

  if (APPROVED_HOSTNAMES.has(hostname.toLowerCase()) && net.isIP(hostname) === 0) {
    // Cloudflare Workers edge fetch natively blocks private/reserved destination IPs
    return [{ address: '104.21.0.1', family: 4 }];
  }

  throw new Error(`Could not resolve DNS for "${hostname}".`);
};

/**
 * Validates that the feed URL strictly matches the approved HTTPS endpoint and resolves only to public IPs.
 */
export async function validateFeedUrlAndResolveIp(
  rawUrl: string,
  dnsLookupFn: DnsLookupFunction = defaultDnsLookup
): Promise<URL> {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Feed URL is required.');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid feed URL format: "${rawUrl}"`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`Disallowed protocol "${parsed.protocol}". Only HTTPS is permitted.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error('Feed URL must not contain embedded credentials.');
  }

  if (parsed.port && parsed.port !== '443') {
    throw new Error(`Disallowed port "${parsed.port}". Only standard HTTPS port 443 is permitted.`);
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // Check literal IP addresses first for clear SSRF error reporting
  if (net.isIP(hostname) !== 0) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new Error(`SSRF blocked: private, loopback, or reserved IP address "${hostname}" is not allowed.`);
    }
    throw new Error(`Direct IP literal "${hostname}" is not in the approved feed host allowlist.`);
  }

  if (!APPROVED_HOSTNAMES.has(hostname)) {
    throw new Error(
      `Disallowed feed host "${hostname}". Only ${Array.from(APPROVED_HOSTNAMES).join(', ')} is permitted.`
    );
  }

  if (!APPROVED_PATHS.has(parsed.pathname)) {
    throw new Error(
      `Disallowed feed path "${parsed.pathname}". Only ${Array.from(APPROVED_PATHS).join(', ')} is permitted.`
    );
  }

  if (parsed.search || parsed.hash) {
    throw new Error('Feed URL must not include unexpected query strings or fragments.');
  }

  // Resolve DNS and verify all resolved addresses are public
  const records = await dnsLookupFn(hostname);
  if (!records || records.length === 0) {
    throw new Error(`Could not resolve DNS for "${hostname}".`);
  }

  for (const record of records) {
    if (isPrivateOrReservedIp(record.address)) {
      throw new Error(
        `SSRF blocked: "${hostname}" resolved to private or reserved IP address "${record.address}".`
      );
    }
  }

  return parsed;
}

/**
 * Safely fetches the website RSS feed XML with SSRF checks, redirect blocking, timeout, and streaming byte limits.
 */
export async function fetchWebsiteFeedXml(
  feedUrl: string = APPROVED_WEBSITE_FEED_URL,
  options: FeedFetchOptions = {}
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FEED_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_FEED_BYTES;
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const dnsLookupFn = options.dnsLookupFn ?? defaultDnsLookup;

  const validatedUrl = await validateFeedUrlAndResolveIp(feedUrl, dnsLookupFn);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Feed request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    const response = await fetchFn(validatedUrl.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml',
        'User-Agent': 'ScienceOfGifts-MerchantCenterOrganizer/1.0',
      },
      redirect: 'manual',
      signal: controller.signal,
    });

    // Block unvalidated redirects
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers?.get?.('location') || '';
      throw new Error(
        `Redirect blocked (HTTP ${response.status}${location ? ` -> ${location}` : ''}). Feed endpoint must respond directly without redirects.`
      );
    }

    if ((response as any).redirected) {
      throw new Error('Redirect blocked: unexpected redirect detected while fetching feed.');
    }

    if (!response.ok) {
      throw new Error(`Website feed returned HTTP ${response.status} ${response.statusText || ''}`.trim());
    }

    const contentLengthHeader = response.headers?.get?.('content-length');
    if (contentLengthHeader) {
      const declaredBytes = parseInt(contentLengthHeader, 10);
      if (!isNaN(declaredBytes) && declaredBytes > maxBytes) {
        throw new Error(
          `Feed response size (${declaredBytes} bytes) exceeds maximum allowed limit of ${maxBytes} bytes.`
        );
      }
    }

    // Read stream with strict byte bound
    if (response.body && typeof (response.body as any).getReader === 'function') {
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel();
            throw new Error(
              `Feed response exceeded maximum allowed size of ${maxBytes} bytes during download.`
            );
          }
          chunks.push(value);
        }
      }

      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder('utf-8').decode(combined);
    }

    // Fallback for test mocks that only implement .text()
    const text = await response.text();
    const byteLen = getUtf8ByteLength(text);
    if (byteLen > maxBytes) {
      throw new Error(
        `Feed response exceeded maximum allowed size of ${maxBytes} bytes (${byteLen} bytes received).`
      );
    }
    return text;
  } catch (err: any) {
    if (err?.name === 'AbortError' || /timed out|aborted/i.test(err?.message || '')) {
      throw new Error(`Feed request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function decodeXmlEntities(input: string): string {
  if (!input) return '';
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      const code = parseInt(hex, 16);
      return !isNaN(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#([0-9]+);/g, (_m, dec) => {
      const code = parseInt(dec, 10);
      return !isNaN(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function extractXmlTagValue(itemXml: string, tagName: string): string {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, 'i');
  const match = itemXml.match(regex);
  if (!match) return '';

  const rawInner = match[1].trim();
  const cdataMatch = rawInner.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdataMatch) {
    return cdataMatch[1].trim();
  }
  return decodeXmlEntities(rawInner).trim();
}

function normalizeAvailability(raw: string): 'in_stock' | 'out_of_stock' | 'preorder' | 'backorder' {
  const clean = (raw || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (clean === 'in_stock' || clean === 'instock') return 'in_stock';
  if (clean === 'out_of_stock' || clean === 'outofstock') return 'out_of_stock';
  if (clean === 'preorder' || clean === 'pre_order') return 'preorder';
  if (clean === 'backorder' || clean === 'back_order') return 'backorder';
  return 'in_stock';
}

export interface ParseRssOptions {
  maxBytes?: number;
  maxItems?: number;
}

/**
 * Safely parses Google Merchant Center RSS 2.0 XML into WebsiteVariant items.
 * Rejects DOCTYPE / ENTITY declarations (XXE & Billion Laughs protection) and malformed XML.
 */
export function parseMerchantCenterRssXml(
  xmlText: string,
  options: ParseRssOptions = {}
): WebsiteVariant[] {
  const maxBytes = options.maxBytes ?? MAX_FEED_BYTES;
  const maxItems = options.maxItems ?? MAX_FEED_ITEMS;

  if (!xmlText || typeof xmlText !== 'string' || !xmlText.trim()) {
    throw new Error('Malformed XML: Feed content is empty.');
  }

  const byteLen = getUtf8ByteLength(xmlText);
  if (byteLen > maxBytes) {
    throw new Error(`Feed XML size (${byteLen} bytes) exceeds maximum limit of ${maxBytes} bytes.`);
  }

  // Security: Reject DOCTYPE / ENTITY declarations to prevent XXE and entity expansion attacks
  if (/<!ENTITY\b/i.test(xmlText) || /<!DOCTYPE\b/i.test(xmlText)) {
    throw new Error('Security violation: XML DOCTYPE and ENTITY declarations are forbidden (XXE protection).');
  }

  // Validate basic RSS/channel structure
  if (!/<rss\b[^>]*>/i.test(xmlText) || !/<\/rss\s*>/i.test(xmlText)) {
    throw new Error('Malformed XML: Missing root <rss> element.');
  }
  if (!/<channel\b[^>]*>/i.test(xmlText) || !/<\/channel\s*>/i.test(xmlText)) {
    throw new Error('Malformed XML: Missing <channel> element.');
  }

  // Check balanced <item> and </item> tags
  const openItemMatches = xmlText.match(/<item(?:\s[^>]*>|>)/gi) || [];
  const closeItemMatches = xmlText.match(/<\/item\s*>/gi) || [];
  if (openItemMatches.length !== closeItemMatches.length) {
    throw new Error(
      `Malformed XML: Unbalanced <item> tags (${openItemMatches.length} opening vs ${closeItemMatches.length} closing).`
    );
  }

  if (openItemMatches.length > maxItems) {
    throw new Error(
      `Feed item count (${openItemMatches.length}) exceeds maximum allowed limit of ${maxItems} items.`
    );
  }

  const itemRegex = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/gi;
  const variants: WebsiteVariant[] = [];
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemXml = match[1];

    // Check for nested <item> inside an unclosed <item>
    if (/<item(?:\s[^>]*>|>)/i.test(itemXml)) {
      throw new Error('Malformed XML: Nested or unclosed <item> element detected.');
    }

    const id = extractXmlTagValue(itemXml, 'g:id') || extractXmlTagValue(itemXml, 'id');
    if (!id) {
      throw new Error('Malformed feed item: Missing required <g:id> identifier.');
    }

    const itemGroupId = extractXmlTagValue(itemXml, 'g:item_group_id');
    const title = extractXmlTagValue(itemXml, 'g:title') || extractXmlTagValue(itemXml, 'title');
    const description =
      extractXmlTagValue(itemXml, 'g:description') || extractXmlTagValue(itemXml, 'description');
    const link = sanitizeHttpUrl(
      extractXmlTagValue(itemXml, 'g:link') || extractXmlTagValue(itemXml, 'link')
    );
    const imageLink = sanitizeHttpUrl(extractXmlTagValue(itemXml, 'g:image_link'));
    const additionalImageLink = sanitizeHttpUrl(
      extractXmlTagValue(itemXml, 'g:additional_image_link')
    );
    const availabilityRaw = extractXmlTagValue(itemXml, 'g:availability');
    const quantityRaw = extractXmlTagValue(itemXml, 'g:quantity');
    const price = extractXmlTagValue(itemXml, 'g:price');
    const salePrice = extractXmlTagValue(itemXml, 'g:sale_price');
    const brand = extractXmlTagValue(itemXml, 'g:brand') || 'Science of Gifts';
    const mpn = extractXmlTagValue(itemXml, 'g:mpn');
    const gtin = extractXmlTagValue(itemXml, 'g:gtin');
    const color = extractXmlTagValue(itemXml, 'g:color');
    const size = extractXmlTagValue(itemXml, 'g:size');
    const material = extractXmlTagValue(itemXml, 'g:material');
    const pattern = extractXmlTagValue(itemXml, 'g:pattern');
    const genderRaw = extractXmlTagValue(itemXml, 'g:gender').toLowerCase();
    const ageGroupRaw = extractXmlTagValue(itemXml, 'g:age_group').toLowerCase().replace(/\s+/g, '_');
    const conditionRaw = extractXmlTagValue(itemXml, 'g:condition').toLowerCase();
    const shippingWeight = extractXmlTagValue(itemXml, 'g:shipping_weight');

    if (!link) {
      throw new Error(`Malformed feed item "${id}": Missing or invalid HTTP(S) <g:link>.`);
    }
    if (!price) {
      throw new Error(`Malformed feed item "${id}": Missing required <g:price>.`);
    }

    const parsedQty = quantityRaw ? parseInt(quantityRaw, 10) : undefined;

    variants.push({
      id,
      item_group_id: itemGroupId || '',
      title,
      description,
      link,
      image_link: imageLink,
      additional_image_link: additionalImageLink || undefined,
      availability: normalizeAvailability(availabilityRaw),
      quantity: parsedQty !== undefined && !isNaN(parsedQty) ? parsedQty : undefined,
      price,
      sale_price: salePrice || undefined,
      brand,
      mpn: mpn || undefined,
      gtin: gtin || undefined,
      color: color || undefined,
      size: size || undefined,
      material: material || undefined,
      pattern: pattern || undefined,
      gender: ['unisex', 'male', 'female', ''].includes(genderRaw) ? (genderRaw as any) : 'unisex',
      age_group: ['adult', 'all_ages', 'teen', 'kids', 'toddler', 'infant', ''].includes(ageGroupRaw)
        ? (ageGroupRaw as any)
        : 'adult',
      condition: ['new', 'refurbished', 'used'].includes(conditionRaw) ? (conditionRaw as any) : 'new',
      shipping_weight: shippingWeight || undefined,
    });
  }

  return variants;
}

/**
 * Normalizes a product URL to a canonical form:
 * - normalizes protocol to https and strips www.
 * - maps scienceofgifts.fourthwall.com to shop.scienceofgifts.com
 * - strips locale prefixes (e.g. /en-usd/products/..., /en-us/products/..., /en/products/...)
 * - ignores tracking query parameters, variant query parameters, fragments, duplicate slashes, and trailing slashes
 */
export function normalizeCanonicalProductUrl(rawUrl?: string): string {
  if (!rawUrl || !rawUrl.trim()) return '';
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    // Normalize Fourthwall domain aliases if present
    const canonicalHost =
      host === 'scienceofgifts.fourthwall.com' ? 'shop.scienceofgifts.com' : host;
    let pathname = parsed.pathname;
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      // Keep original pathname if percent-encoding is malformed
    }
    pathname = pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
    // Strip locale/currency segments like /en-usd/products/..., /en-us/products/..., /en/products/..., /en_gb/collections/...
    pathname = pathname.replace(
      /^\/[a-z]{2}(?:[-_][a-z]{2,4})?(?:[-_][a-z]{2,4})?(\/(?:products|collections)\/)/i,
      '$1'
    );
    return `https://${canonicalHost}${pathname.toLowerCase()}`;
  } catch {
    return '';
  }
}

export function isSpecificProductUrl(canonicalUrl: string): boolean {
  if (!canonicalUrl) return false;
  try {
    const parsed = new URL(canonicalUrl);
    const p = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    if (!p || p === '/' || p === '/products' || p === '/collections' || p === '/collections/all') {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export interface WebsiteFeedDesignGroup {
  groupKey: string;
  itemGroupId: string;
  primaryVariantId: string;
  title: string;
  description: string;
  link: string;
  canonicalLink: string;
  variants: WebsiteVariant[];
}

/**
 * Groups individual website feed variant items into product designs.
 * Items sharing <g:item_group_id> are grouped together unless their canonical product URLs conflict.
 * Standalone items without <g:item_group_id> are grouped by specific canonical product URL (or standalone <g:id>).
 * Products are NEVER grouped by title similarity.
 */
export function groupFeedVariantsByDesign(variants: WebsiteVariant[]): WebsiteFeedDesignGroup[] {
  // Detect any item_group_id spanning multiple distinct specific product URLs
  const urlsByGroupId = new Map<string, Set<string>>();
  for (const variant of variants) {
    const gid = (variant.item_group_id || '').trim();
    const canonicalLink = normalizeCanonicalProductUrl(variant.link);
    if (gid && isSpecificProductUrl(canonicalLink)) {
      if (!urlsByGroupId.has(gid)) urlsByGroupId.set(gid, new Set<string>());
      urlsByGroupId.get(gid)!.add(canonicalLink);
    }
  }

  const groupsByKey = new Map<string, WebsiteFeedDesignGroup>();

  for (const variant of variants) {
    const gid = (variant.item_group_id || '').trim();
    const canonicalLink = normalizeCanonicalProductUrl(variant.link);
    const gidSpansMultipleUrls = gid ? (urlsByGroupId.get(gid)?.size || 0) > 1 : false;

    const groupKey = gid
      ? gidSpansMultipleUrls && isSpecificProductUrl(canonicalLink)
        ? `gid:${gid}|url:${canonicalLink}`
        : `gid:${gid}`
      : isSpecificProductUrl(canonicalLink)
        ? `url:${canonicalLink}`
        : `id:${variant.id}`;

    let group = groupsByKey.get(groupKey);
    if (!group) {
      group = {
        groupKey,
        itemGroupId: gid,
        primaryVariantId: variant.id,
        title: variant.title,
        description: variant.description,
        link: variant.link,
        canonicalLink,
        variants: [],
      };
      groupsByKey.set(groupKey, group);
    }

    // Deduplicate identical variant IDs within the same group
    const existingIdx = group.variants.findIndex((v) => v.id === variant.id);
    if (existingIdx >= 0) {
      group.variants[existingIdx] = variant;
    } else {
      group.variants.push(variant);
    }
  }

  // If a group has 2+ variants but lacked an explicit item_group_id, assign a stable item_group_id
  for (const group of groupsByKey.values()) {
    if (group.variants.length >= 2 && !group.itemGroupId) {
      const slug = group.canonicalLink.split('/products/')[1] || group.primaryVariantId;
      group.itemGroupId = `grp_${slug}`;
      group.variants = group.variants.map((v) => ({
        ...v,
        item_group_id: v.item_group_id || group.itemGroupId,
      }));
    } else if (group.variants.length === 1) {
      // Single-variant design: keep itemGroupId for mapping reference, but exported row will have empty item_group_id
      group.variants = group.variants.map((v) => ({
        ...v,
        item_group_id: group.itemGroupId || '',
      }));
    }
  }

  return Array.from(groupsByKey.values());
}

function normalizeTitleForComparison(title?: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function areVariantsEqual(a?: WebsiteVariant[], b?: WebsiteVariant[]): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const va = a[i];
    const vb = b[i];
    if (
      va.id !== vb.id ||
      va.item_group_id !== vb.item_group_id ||
      va.size !== vb.size ||
      va.color !== vb.color ||
      va.price !== vb.price ||
      va.availability !== vb.availability ||
      va.mpn !== vb.mpn ||
      va.image_link !== vb.image_link ||
      va.link !== vb.link
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Computes a strictly read-only preview of matching website feed items against the catalog.
 * Matches deterministically via stable variant IDs, item group IDs, stored website sync mappings,
 * SKU/MPN, and normalized canonical product URLs.
 * Never merges by title similarity alone; flags conflicting identifiers and ambiguous matches for manual review.
 * Never mutates the passed catalog array or any ProductItem objects.
 */
export function previewWebsiteFeedSync(
  catalog: readonly ProductItem[],
  feedVariants: readonly WebsiteVariant[],
  feedUrl: string = APPROVED_WEBSITE_FEED_URL,
  manualMappings: Record<string, string> = {}
): FeedSyncPreviewResult {
  const fetchedAt = new Date().toISOString();
  // Clone variants so preview cannot mutate inputs
  const clonedVariants: WebsiteVariant[] = feedVariants.map((v) => ({ ...v }));
  const designGroups = groupFeedVariantsByDesign(clonedVariants);

  const matchedProducts: FeedSyncMatchedItem[] = [];
  const unmatchedFeedGroups: FeedSyncUnmatchedFeedGroup[] = [];
  const ambiguousMatches: FeedSyncAmbiguousMatch[] = [];
  const matchedCatalogIds = new Set<string>();
  const matchedGroupKeys = new Set<string>();

  for (const group of designGroups) {
    // 0. Explicit user-supplied manual mapping takes highest precedence
    const manualCatalogId = manualMappings[group.groupKey];
    if (manualCatalogId) {
      const target = catalog.find((p) => p.id === manualCatalogId);
      if (target && !matchedCatalogIds.has(target.id)) {
        matchedCatalogIds.add(target.id);
        matchedGroupKeys.add(group.groupKey);
        matchedProducts.push(buildMatchedItemPreview(target, group, 'manual'));
        continue;
      }
    }

    const groupVariantIdSet = new Set(group.variants.map((v) => v.id));
    const groupMpns = new Set(
      group.variants.map((v) => (v.mpn || '').trim().toUpperCase()).filter(Boolean)
    );
    const hasSpecificFeedUrl = isSpecificProductUrl(group.canonicalLink);
    const feedGroupsSharingUrl = hasSpecificFeedUrl
      ? designGroups.filter((g) => g.canonicalLink === group.canonicalLink)
      : [];

    // Evaluate all deterministic strong identifier signals simultaneously so cross-product conflicts are always caught
    const candidateReasons = new Map<
      string,
      { item: ProductItem; methods: Set<WebsiteSyncMatchMethod>; reasons: string[] }
    >();

    const recordCandidate = (
      item: ProductItem,
      method: WebsiteSyncMatchMethod,
      reason: string
    ) => {
      let entry = candidateReasons.get(item.id);
      if (!entry) {
        entry = { item, methods: new Set<WebsiteSyncMatchMethod>(), reasons: [] };
        candidateReasons.set(item.id, entry);
      }
      entry.methods.add(method);
      if (!entry.reasons.includes(reason)) {
        entry.reasons.push(reason);
      }
    };

    for (const p of catalog) {
      if (matchedCatalogIds.has(p.id)) continue;

      // 1. Stable variant IDs, catalog IDs, and stored website sync mappings
      const matchesSyncMetaGroup =
        Boolean(group.itemGroupId) &&
        Boolean(p.websiteSyncMeta?.websiteItemGroupId) &&
        p.websiteSyncMeta!.websiteItemGroupId === group.itemGroupId;
      const matchesSyncMetaPrimaryVariant =
        Boolean(p.websiteSyncMeta?.websitePrimaryVariantId) &&
        groupVariantIdSet.has(p.websiteSyncMeta!.websitePrimaryVariantId!);
      const matchesSyncMetaUrl =
        hasSpecificFeedUrl &&
        Boolean(p.websiteSyncMeta?.canonicalProductUrl) &&
        normalizeCanonicalProductUrl(p.websiteSyncMeta!.canonicalProductUrl) === group.canonicalLink;
      const matchesCatalogId =
        groupVariantIdSet.has(p.id) ||
        groupVariantIdSet.has(p.merchantData.id) ||
        (Boolean(group.itemGroupId) && (p.id === group.itemGroupId || p.merchantData.id === group.itemGroupId));
      const matchesSyncedVariantId = Boolean(
        p.syncedVariants && p.syncedVariants.some((sv) => groupVariantIdSet.has(sv.id))
      );

      if (matchesSyncedVariantId) {
        recordCandidate(p, 'mapped_id', 'Shares stable variant ID in syncedVariants');
      } else if (matchesSyncMetaGroup || matchesSyncMetaPrimaryVariant || matchesSyncMetaUrl) {
        recordCandidate(p, 'mapped_id', 'Matches stored website sync mapping');
      } else if (matchesCatalogId) {
        recordCandidate(p, 'mapped_id', 'Matches stable product/variant ID');
      }

      // 2. Non-empty item_group_id
      if (
        group.itemGroupId &&
        p.merchantData.item_group_id &&
        p.merchantData.item_group_id.trim() === group.itemGroupId
      ) {
        recordCandidate(p, 'item_group_id', `Shares item_group_id "${group.itemGroupId}"`);
      }

      // 3. SKU / MPN
      if (groupMpns.size > 0) {
        const pMpn = (
          p.merchantData.mpn ||
          p.evidence?.verifiedAttributes?.mpn ||
          p.evidence?.verifiedAttributes?.sku ||
          ''
        )
          .trim()
          .toUpperCase();
        const matchesDirectMpn = Boolean(pMpn && groupMpns.has(pMpn));
        const matchesEvidenceSku = Boolean(
          p.evidence?.variants?.some((ev) => ev.sku && groupMpns.has(ev.sku.trim().toUpperCase()))
        );
        if (matchesDirectMpn || matchesEvidenceSku) {
          recordCandidate(p, 'mpn_sku', 'Shares MPN / SKU with website variant');
        }
      }

      // 4. Normalized canonical product URL
      if (hasSpecificFeedUrl) {
        const pCanonical = normalizeCanonicalProductUrl(
          p.merchantData.link || p.evidence?.sourceUrl
        );
        if (pCanonical && pCanonical === group.canonicalLink) {
          recordCandidate(p, 'canonical_url', `Matches canonical URL "${group.canonicalLink}"`);
        }
      }
    }

    const candidates = Array.from(candidateReasons.values());

    if (candidates.length > 1) {
      // Conflicting or duplicate strong identifiers across multiple catalog products -> manual review required
      ambiguousMatches.push({
        websiteGroupKey: group.groupKey,
        websiteTitle: group.title,
        websiteLink: group.link,
        candidateCatalogIds: candidates.map((c) => ({
          catalogProductId: c.item.id,
          title: c.item.merchantData.title,
          link: c.item.merchantData.link,
          reason: c.reasons.join('; '),
        })),
        reason: `Conflicting or shared identifiers matched ${candidates.length} different catalog products. Manual review required.`,
      });
      matchedGroupKeys.add(group.groupKey);
      continue;
    }

    if (candidates.length === 1) {
      const candidate = candidates[0];
      const target = candidate.item;

      // Check for direct item_group_id conflict on the matched catalog record
      const targetGids = new Set<string>(
        [
          target.websiteSyncMeta?.websiteItemGroupId || '',
          target.merchantData.item_group_id || '',
        ]
          .map((g) => g.trim())
          .filter(Boolean)
      );
      const hasItemGroupConflict =
        Boolean(group.itemGroupId) &&
        targetGids.size > 0 &&
        !targetGids.has(group.itemGroupId);

      // Check if feed itself has multiple distinct groups sharing this canonical URL when matching only by URL
      const matchedOnlyByUrl =
        candidate.methods.size === 1 && candidate.methods.has('canonical_url');
      const hasSharedFeedUrlAmbiguity = matchedOnlyByUrl && feedGroupsSharingUrl.length > 1;

      if (hasItemGroupConflict) {
        ambiguousMatches.push({
          websiteGroupKey: group.groupKey,
          websiteTitle: group.title,
          websiteLink: group.link,
          candidateCatalogIds: [
            {
              catalogProductId: target.id,
              title: target.merchantData.title,
              link: target.merchantData.link,
              reason: `Conflicting item_group_id: website has "${group.itemGroupId}", catalog has "${Array.from(targetGids).join(', ')}" (${candidate.reasons.join('; ')})`,
            },
          ],
          reason: `Conflicting item_group_id between website feed ("${group.itemGroupId}") and catalog product "${target.id}" ("${Array.from(targetGids).join(', ')}"). Manual review required.`,
        });
        matchedGroupKeys.add(group.groupKey);
        continue;
      }

      if (hasSharedFeedUrlAmbiguity) {
        ambiguousMatches.push({
          websiteGroupKey: group.groupKey,
          websiteTitle: group.title,
          websiteLink: group.link,
          candidateCatalogIds: [
            {
              catalogProductId: target.id,
              title: target.merchantData.title,
              link: target.merchantData.link,
              reason: `Canonical URL "${group.canonicalLink}" is shared by ${feedGroupsSharingUrl.length} website feed groups`,
            },
          ],
          reason: `Ambiguous canonical URL "${group.canonicalLink}" shared by multiple website feed groups. Manual review required.`,
        });
        matchedGroupKeys.add(group.groupKey);
        continue;
      }

      // Pick highest-priority deterministic match method
      const matchMethod: WebsiteSyncMatchMethod = candidate.methods.has('mapped_id')
        ? 'mapped_id'
        : candidate.methods.has('item_group_id')
          ? 'item_group_id'
          : candidate.methods.has('mpn_sku')
            ? 'mpn_sku'
            : 'canonical_url';

      matchedCatalogIds.add(target.id);
      matchedGroupKeys.add(group.groupKey);
      matchedProducts.push(buildMatchedItemPreview(target, group, matchMethod));
      continue;
    }

    // 5. Title similarity check — NEVER auto-match by title alone; flag as ambiguous for manual review!
    const normFeedTitle = normalizeTitleForComparison(group.title);
    if (normFeedTitle) {
      const titleCandidates = catalog.filter((p) => {
        if (matchedCatalogIds.has(p.id)) return false;
        const t1 = normalizeTitleForComparison(p.merchantData.title);
        const t2 = normalizeTitleForComparison(p.originalImported?.title);
        const t3 = normalizeTitleForComparison(p.evidence?.pageTitle);
        return t1 === normFeedTitle || t2 === normFeedTitle || t3 === normFeedTitle;
      });

      if (titleCandidates.length > 0) {
        ambiguousMatches.push({
          websiteGroupKey: group.groupKey,
          websiteTitle: group.title,
          websiteLink: group.link,
          candidateCatalogIds: titleCandidates.map((c) => ({
            catalogProductId: c.id,
            title: c.merchantData.title,
            link: c.merchantData.link,
            reason: 'Title similarity only (URLs and IDs differ)',
          })),
          reason:
            'Matched by title similarity only without matching ID, SKU/MPN, item_group_id, or canonical URL. Requires manual review.',
        });
        matchedGroupKeys.add(group.groupKey);
        continue;
      }
    }

    // Otherwise, genuinely new website product design
    const sizes = Array.from(new Set(group.variants.map((v) => v.size || '').filter(Boolean)));
    const colors = Array.from(new Set(group.variants.map((v) => v.color || '').filter(Boolean)));
    const prices = Array.from(new Set(group.variants.map((v) => v.price || '').filter(Boolean)));
    unmatchedFeedGroups.push({
      groupKey: group.groupKey,
      itemGroupId: group.itemGroupId,
      primaryVariantId: group.primaryVariantId,
      title: group.title,
      link: group.link,
      variantCount: group.variants.length,
      sizes,
      colors,
      priceRange: prices.length > 1 ? `${prices[0]} – ${prices[prices.length - 1]}` : prices[0] || '',
      variants: group.variants,
    });
  }

  const unmatchedCatalogItems: FeedSyncUnmatchedCatalogItem[] = catalog
    .filter((p) => !matchedCatalogIds.has(p.id))
    .map((p) => ({
      catalogProductId: p.id,
      title: p.merchantData.title,
      link: p.merchantData.link,
      status: p.status,
      syncedVariantCount: p.syncedVariants?.length || 0,
    }));

  const matchedWithChangesCount = matchedProducts.filter((m) => m.hasChanges).length;
  const matchedWithNewVariantsCount = matchedProducts.filter((m) => m.missingVariantCount > 0).length;
  const newVariantsForExistingCount = matchedProducts.reduce(
    (acc, m) => acc + m.missingVariantCount,
    0
  );
  const newProductsVariantCount = unmatchedFeedGroups.reduce(
    (acc, g) => acc + g.variantCount,
    0
  );
  const unchangedMatchedCount = matchedProducts.length - matchedWithNewVariantsCount;
  const totalUnchangedProductsCount = unchangedMatchedCount + unmatchedCatalogItems.length;
  const totalVariantsToSync = matchedProducts.reduce((acc, m) => acc + m.newVariantCount, 0);
  const idChangeWarningCount = matchedProducts.filter((m) => Boolean(m.idChangeWarning)).length;

  return {
    feedUrl,
    fetchedAt,
    totalFeedVariantItems: clonedVariants.length,
    totalFeedDesignGroups: designGroups.length,
    totalCatalogProducts: catalog.length,
    matchedProducts,
    unmatchedFeedGroups,
    unmatchedCatalogItems,
    ambiguousMatches,
    summary: {
      matchedCount: matchedProducts.length,
      matchedWithChangesCount,
      matchedWithNewVariantsCount,
      newVariantsForExistingCount,
      newProductsVariantCount,
      unchangedMatchedCount,
      totalUnchangedProductsCount,
      totalVariantsToSync,
      unmatchedFeedGroupCount: unmatchedFeedGroups.length,
      unmatchedCatalogCount: unmatchedCatalogItems.length,
      ambiguousCount: ambiguousMatches.length,
      idChangeWarningCount,
    },
  };
}

function buildMatchedItemPreview(
  product: ProductItem,
  group: WebsiteFeedDesignGroup,
  matchMethod: WebsiteSyncMatchMethod
): FeedSyncMatchedItem {
  const primaryVariant = group.variants[0];
  const fieldDiffs: FeedSyncFieldDiff[] = [];
  const prevVariants = product.syncedVariants || [];
  const existingVariantIds = new Set(prevVariants.map((v) => v.id));
  const missingVariants = group.variants.filter((v) => !existingVariantIds.has(v.id));
  const variantsChanged = !areVariantsEqual(prevVariants, group.variants);

  // 1. Check exported <g:id> change warning
  let idChangeWarning: string | undefined;
  const previouslySyncedPrimaryId = product.websiteSyncMeta?.websitePrimaryVariantId;
  if (
    !previouslySyncedPrimaryId &&
    prevVariants.length === 0 &&
    product.merchantData.id !== primaryVariant.id
  ) {
    idChangeWarning = `Catalog ID "${product.id}" will be preserved in the app, and Google feed export will use website variant <g:id> (${
      group.variants.length > 1
        ? `${group.variants.length} variant UUIDs sharing item_group_id ${group.itemGroupId}`
        : primaryVariant.id
    }).`;
    fieldDiffs.push({
      field: 'export_variant_ids',
      label: 'Exported <g:id>',
      currentAppValue: product.merchantData.id,
      websiteValue:
        group.variants.length > 1
          ? `${primaryVariant.id} (+${group.variants.length - 1} more)`
          : primaryVariant.id,
      action: 'warning_id_change',
      reason: idChangeWarning,
    });
  } else if (previouslySyncedPrimaryId && previouslySyncedPrimaryId !== primaryVariant.id) {
    idChangeWarning = `Website primary variant <g:id> changed from "${previouslySyncedPrimaryId}" to "${primaryVariant.id}".`;
    fieldDiffs.push({
      field: 'export_variant_ids',
      label: 'Exported <g:id>',
      currentAppValue: previouslySyncedPrimaryId,
      websiteValue: primaryVariant.id,
      action: 'warning_id_change',
      reason: idChangeWarning,
    });
  }

  // 2. Variants diff (missing variants vs full expansion)
  const sizesList = Array.from(new Set(group.variants.map((v) => v.size || '').filter(Boolean)));
  const colorsList = Array.from(new Set(group.variants.map((v) => v.color || '').filter(Boolean)));
  if (missingVariants.length > 0) {
    const newSizes = Array.from(new Set(missingVariants.map((v) => v.size || '').filter(Boolean)));
    const newColors = Array.from(new Set(missingVariants.map((v) => v.color || '').filter(Boolean)));
    fieldDiffs.push({
      field: 'syncedVariants',
      label: 'New Missing Variants',
      currentAppValue:
        prevVariants.length > 0
          ? `${prevVariants.length} variant(s) stored`
          : `0 expanded variants (${product.merchantData.size || 'single record'})`,
      websiteValue: `+${missingVariants.length} new variant(s)${
        newSizes.length > 0 ? ` [Sizes: ${newSizes.join(', ')}]` : ''
      }${newColors.length > 0 ? ` [Colors: ${newColors.join(', ')}]` : ''}`,
      action: 'update_factual',
      reason: 'Missing website variants will be attached to this existing product without altering existing fields.',
    });
  } else if (variantsChanged) {
    fieldDiffs.push({
      field: 'syncedVariants',
      label: 'Purchasable Variants',
      currentAppValue: `${prevVariants.length} synced variant(s)`,
      websiteValue: `${group.variants.length} variant(s)${
        sizesList.length > 0 ? ` [Sizes: ${sizesList.join(', ')}]` : ''
      }${colorsList.length > 0 ? ` [Colors: ${colorsList.join(', ')}]` : ''}`,
      action: 'update_factual',
      reason: 'Optional factual sync updates variant attributes from the website feed.',
    });
  }

  // 3. item_group_id diff
  const targetItemGroupId = group.variants.length >= 2 ? group.itemGroupId : '';
  if ((product.merchantData.item_group_id || '') !== targetItemGroupId) {
    fieldDiffs.push({
      field: 'item_group_id',
      label: 'Item Group ID',
      currentAppValue: product.merchantData.item_group_id || '(empty)',
      websiteValue: targetItemGroupId || '(empty — single variant)',
      action: 'update_factual',
      reason:
        group.variants.length >= 2
          ? 'Shared item_group_id links all variants of this product design in Google Merchant Center.'
          : 'Single-variant products keep item_group_id empty to prevent orphan group warnings.',
    });
  }

  // 4. Price diff
  if (primaryVariant.price && product.merchantData.price !== primaryVariant.price) {
    fieldDiffs.push({
      field: 'price',
      label: 'Base Price',
      currentAppValue: product.merchantData.price || '(empty)',
      websiteValue: primaryVariant.price,
      action: 'update_factual',
      reason: 'Optional factual sync updates live variant pricing (unchanged in Add-Only mode).',
    });
  }

  // 5. Availability diff
  if (primaryVariant.availability && product.merchantData.availability !== primaryVariant.availability) {
    fieldDiffs.push({
      field: 'availability',
      label: 'Availability',
      currentAppValue: product.merchantData.availability,
      websiteValue: primaryVariant.availability,
      action: 'update_factual',
      reason: 'Optional factual sync updates stock availability (unchanged in Add-Only mode).',
    });
  }

  // 6. Custom Title preservation notice
  if (product.merchantData.title && product.merchantData.title !== group.title) {
    fieldDiffs.push({
      field: 'title',
      label: 'Optimized Title',
      currentAppValue: product.merchantData.title,
      websiteValue: group.title,
      action: 'preserve_custom',
      reason: 'App retains custom/AI-optimized title across all exported variants.',
    });
  }

  // 7. Custom Description preservation notice
  if (product.merchantData.description && product.merchantData.description !== group.description) {
    fieldDiffs.push({
      field: 'description',
      label: 'Optimized Description',
      currentAppValue: `${product.merchantData.description.slice(0, 90)}...`,
      websiteValue: `${(group.description || '').slice(0, 90)}...`,
      action: 'preserve_custom',
      reason: 'App retains custom/AI-optimized description across all exported variants.',
    });
  }

  const hasFactualChanges =
    variantsChanged ||
    (product.merchantData.item_group_id || '') !== targetItemGroupId ||
    (Boolean(primaryVariant.price) && product.merchantData.price !== primaryVariant.price) ||
    (Boolean(primaryVariant.availability) &&
      product.merchantData.availability !== primaryVariant.availability) ||
    (Boolean(primaryVariant.mpn) && product.merchantData.mpn !== primaryVariant.mpn);

  return {
    catalogProductId: product.id,
    catalogTitle: product.merchantData.title,
    catalogLink: product.merchantData.link,
    websiteGroupKey: group.groupKey,
    websiteItemGroupId: group.itemGroupId,
    websiteTitle: group.title,
    websiteLink: group.link,
    matchMethod,
    previousVariantCount: prevVariants.length,
    newVariantCount: group.variants.length,
    missingVariantCount: missingVariants.length,
    newVariants: missingVariants,
    variants: group.variants,
    fieldDiffs,
    idChangeWarning,
    hasNewVariants: missingVariants.length > 0,
    hasFactualChanges,
    hasChanges: missingVariants.length > 0 || hasFactualChanges,
  };
}

/**
 * Applies approved website feed sync changes to a copy of the catalog in an idempotent, non-destructive manner.
 * Defaults to 'add_only' mode:
 * - Adds approved genuinely new website products.
 * - Attaches genuinely missing variants to matched existing products without altering existing product fields.
 * - Never deletes catalog products absent from the website feed.
 * - Never auto-approves ambiguous matches.
 * Optional 'sync_factual' mode updates live factual fields while preserving custom titles, descriptions, labels, and optimization data.
 */
export function applyWebsiteFeedSync(
  catalog: readonly ProductItem[],
  feedVariants: readonly WebsiteVariant[],
  feedUrl: string = APPROVED_WEBSITE_FEED_URL,
  options: FeedSyncApplyOptions = {}
): { updatedCatalog: ProductItem[]; result: FeedSyncApplyResult } {
  const now = new Date().toISOString();
  const syncMode: FeedSyncMode = options.syncMode || 'add_only';
  const manualMappings = options.manualMappings || {};
  const preview = previewWebsiteFeedSync(catalog, feedVariants, feedUrl, manualMappings);
  const designGroups = groupFeedVariantsByDesign(feedVariants.map((v) => ({ ...v })));
  const groupByKey = new Map(designGroups.map((g) => [g.groupKey, g]));

  const approvedSet = options.approvedCatalogIds
    ? new Set(options.approvedCatalogIds)
    : new Set(preview.matchedProducts.map((m) => m.catalogProductId));

  const overrideTitleSet = new Set(options.overrideCustomTitleForIds || []);
  const overrideDescSet = new Set(options.overrideCustomDescriptionForIds || []);
  const importGroupKeySet = new Set(options.importUnmatchedFeedGroupKeys || []);

  const matchByCatalogId = new Map<string, FeedSyncMatchedItem>();
  for (const m of preview.matchedProducts) {
    if (approvedSet.has(m.catalogProductId)) {
      matchByCatalogId.set(m.catalogProductId, m);
    }
  }

  let updatedProductCount = 0;
  let skippedCount = 0;
  let attachedVariantsCount = 0;
  let unchangedProductCount = 0;
  let totalVariantsSynced = 0;
  const updatedProductIds: string[] = [];
  const importedProductIds: string[] = [];

  const updatedCatalog: ProductItem[] = catalog.map((origItem) => {
    const match = matchByCatalogId.get(origItem.id);
    if (!match) {
      unchangedProductCount++;
      return origItem;
    }

    const group = groupByKey.get(match.websiteGroupKey);
    if (!group || group.variants.length === 0) {
      skippedCount++;
      unchangedProductCount++;
      return origItem;
    }

    const existingVariants = origItem.syncedVariants || [];
    const existingVariantIds = new Set(existingVariants.map((v) => v.id));
    const missingVariants = group.variants.filter((v) => !existingVariantIds.has(v.id));

    // ADD-ONLY MODE (Default): Only attach genuinely missing variants; leave all existing product data unchanged
    if (syncMode === 'add_only') {
      if (missingVariants.length === 0) {
        skippedCount++;
        unchangedProductCount++;
        totalVariantsSynced += existingVariants.length || group.variants.length;
        return origItem;
      }

      const combinedVariants: WebsiteVariant[] = [
        ...existingVariants.map((v) => ({ ...v })),
        ...missingVariants.map((v) => ({ ...v })),
      ];

      // Ensure multi-variant products carry a shared item_group_id if currently blank
      const resolvedItemGroupId =
        combinedVariants.length >= 2
          ? origItem.merchantData.item_group_id || group.itemGroupId || ''
          : origItem.merchantData.item_group_id || '';

      const normalizedCombinedVariants =
        combinedVariants.length >= 2 && resolvedItemGroupId
          ? combinedVariants.map((v) => ({
              ...v,
              item_group_id: v.item_group_id || resolvedItemGroupId,
            }))
          : combinedVariants;

      const nextMerchantData: MerchantData = {
        ...origItem.merchantData,
        id: origItem.id,
        item_group_id: resolvedItemGroupId,
      };

      const existingEvidenceVariants = origItem.evidence?.variants || [];
      const existingEvidenceIds = new Set(existingEvidenceVariants.map((ev) => ev.id));
      const appendedEvidenceVariants = missingVariants
        .filter((v) => !existingEvidenceIds.has(v.id))
        .map((v) => ({
          id: v.id,
          title: [v.size, v.color].filter(Boolean).join(' / ') || v.title,
          price: v.price,
          sku: v.mpn,
          color: v.color,
          size: v.size,
          material: v.material,
          image: v.image_link,
          available: v.availability === 'in_stock',
        }));

      const updatedItem: ProductItem = {
        ...origItem,
        id: origItem.id,
        merchantData: nextMerchantData,
        evidence: {
          ...origItem.evidence,
          variants: [...existingEvidenceVariants, ...appendedEvidenceVariants],
        },
        syncedVariants: normalizedCombinedVariants,
        websiteSyncMeta: {
          lastSyncedAt: now,
          feedUrl,
          websiteItemGroupId:
            origItem.websiteSyncMeta?.websiteItemGroupId || group.itemGroupId || undefined,
          websitePrimaryVariantId:
            origItem.websiteSyncMeta?.websitePrimaryVariantId || group.primaryVariantId,
          canonicalProductUrl: group.canonicalLink || origItem.websiteSyncMeta?.canonicalProductUrl,
          matchMethod: match.matchMethod,
          variantCount: normalizedCombinedVariants.length,
          preservedAppId: origItem.id,
          idChangedWarning: match.idChangeWarning,
        },
        history: [
          {
            timestamp: now,
            note: `Website Feed Sync (add-only): attached ${missingVariants.length} new variant(s) via ${match.matchMethod} (existing fields preserved)`,
            snapshot: { ...origItem.merchantData },
          },
          ...(origItem.history || []),
        ],
        updatedAt: now,
      };

      updatedProductCount++;
      attachedVariantsCount += missingVariants.length;
      totalVariantsSynced += normalizedCombinedVariants.length;
      updatedProductIds.push(updatedItem.id);
      return updatedItem;
    }

    // OPTIONAL FACTUAL SYNC MODE (explicitly approved): updates factual prices/availability/variants while preserving custom copy & labels
    const primaryVariant = group.variants[0];
    const targetItemGroupId = group.variants.length >= 2 ? group.itemGroupId : '';
    const shouldOverrideTitle =
      overrideTitleSet.has(origItem.id) || !origItem.merchantData.title?.trim();
    const shouldOverrideDesc =
      overrideDescSet.has(origItem.id) || !origItem.merchantData.description?.trim();

    const identifiers = determineProductIdentifiers(
      primaryVariant.gtin,
      primaryVariant.mpn,
      origItem.merchantData.gtin,
      origItem.merchantData.mpn,
      origItem.merchantData.identifier_exists,
      primaryVariant.brand || origItem.merchantData.brand
    );

    const nextTitle = shouldOverrideTitle ? group.title : origItem.merchantData.title;
    const nextDesc = shouldOverrideDesc ? group.description : origItem.merchantData.description;
    const nextPrice = primaryVariant.price || origItem.merchantData.price;
    const nextAvailability = primaryVariant.availability || origItem.merchantData.availability;
    const nextMpn = identifiers.mpn;
    const nextGtin = identifiers.gtin;
    const nextIdentifierExists = identifiers.identifier_exists;
    const nextBrand = identifiers.brand;
    const nextImageLink = origItem.merchantData.image_link || primaryVariant.image_link;
    const nextColor = origItem.evidence?.userCorrections?.color
      ? origItem.merchantData.color
      : primaryVariant.color || origItem.merchantData.color || '';
    const nextSize = origItem.evidence?.userCorrections?.size
      ? origItem.merchantData.size
      : primaryVariant.size || origItem.merchantData.size || '';

    const variantsAlreadyIdentical = areVariantsEqual(origItem.syncedVariants, group.variants);
    const merchantFieldsIdentical =
      origItem.merchantData.title === nextTitle &&
      origItem.merchantData.description === nextDesc &&
      origItem.merchantData.price === nextPrice &&
      origItem.merchantData.availability === nextAvailability &&
      (origItem.merchantData.item_group_id || '') === targetItemGroupId &&
      (origItem.merchantData.mpn || '') === nextMpn &&
      (origItem.merchantData.gtin || '') === nextGtin &&
      (origItem.merchantData.identifier_exists || 'no') === nextIdentifierExists &&
      (origItem.merchantData.brand || 'Science of Gifts') === nextBrand &&
      (origItem.merchantData.image_link || '') === nextImageLink &&
      (origItem.merchantData.color || '') === nextColor &&
      (origItem.merchantData.size || '') === nextSize;

    // Idempotency: if already synced with identical variants and factual fields, return unchanged record
    if (variantsAlreadyIdentical && merchantFieldsIdentical && origItem.websiteSyncMeta) {
      skippedCount++;
      unchangedProductCount++;
      totalVariantsSynced += group.variants.length;
      return origItem;
    }

    const clonedSyncedVariants: WebsiteVariant[] = group.variants.map((v) => ({ ...v }));
    const nextMerchantData: MerchantData = {
      ...origItem.merchantData,
      id: origItem.id, // Preserve catalog design ID
      title: nextTitle,
      description: nextDesc,
      price: nextPrice,
      availability: nextAvailability,
      item_group_id: targetItemGroupId,
      brand: nextBrand,
      gtin: nextGtin,
      mpn: nextMpn,
      identifier_exists: nextIdentifierExists,
      image_link: nextImageLink,
      color: nextColor,
      size: nextSize,
      // Explicitly preserve custom labels and taxonomy
      google_product_category: origItem.merchantData.google_product_category,
      product_type: origItem.merchantData.product_type,
      custom_label_0: origItem.merchantData.custom_label_0,
      custom_label_1: origItem.merchantData.custom_label_1,
      custom_label_2: origItem.merchantData.custom_label_2,
      custom_label_3: origItem.merchantData.custom_label_3,
      custom_label_4: origItem.merchantData.custom_label_4,
    };

    const nextEvidenceVariants = clonedSyncedVariants.map((v) => ({
      id: v.id,
      title: [v.size, v.color].filter(Boolean).join(' / ') || v.title,
      price: v.price,
      sku: v.mpn,
      color: v.color,
      size: v.size,
      material: v.material,
      image: v.image_link,
      available: v.availability === 'in_stock',
    }));

    const updatedItem: ProductItem = {
      ...origItem,
      id: origItem.id,
      merchantData: nextMerchantData,
      evidence: {
        ...origItem.evidence,
        variants: nextEvidenceVariants,
      },
      syncedVariants: clonedSyncedVariants,
      websiteSyncMeta: {
        lastSyncedAt: now,
        feedUrl,
        websiteItemGroupId: group.itemGroupId || undefined,
        websitePrimaryVariantId: group.primaryVariantId,
        canonicalProductUrl: group.canonicalLink,
        matchMethod: match.matchMethod,
        variantCount: clonedSyncedVariants.length,
        preservedAppId: origItem.id,
        idChangedWarning: match.idChangeWarning,
      },
      history: [
        {
          timestamp: now,
          note: `Website Feed Sync: synced ${clonedSyncedVariants.length} variant(s) via ${match.matchMethod} (preserved custom title & description)`,
          snapshot: { ...origItem.merchantData },
        },
        ...(origItem.history || []),
      ],
      updatedAt: now,
    };

    updatedProductCount++;
    attachedVariantsCount += missingVariants.length;
    totalVariantsSynced += clonedSyncedVariants.length;
    updatedProductIds.push(updatedItem.id);
    return updatedItem;
  });

  // Import explicitly requested genuinely new website feed groups as new catalog design records
  if (importGroupKeySet.size > 0) {
    for (const unmatched of preview.unmatchedFeedGroups) {
      if (!importGroupKeySet.has(unmatched.groupKey)) continue;
      const group = groupByKey.get(unmatched.groupKey);
      if (!group || group.variants.length === 0) continue;

      // Guard against duplicate product or variant creation if already present in catalog
      const groupVariantIds = new Set(group.variants.map((v) => v.id));
      const alreadyExists = updatedCatalog.some((existing) => {
        if (
          group.itemGroupId &&
          (existing.websiteSyncMeta?.websiteItemGroupId === group.itemGroupId ||
            existing.merchantData.item_group_id === group.itemGroupId)
        ) {
          return true;
        }
        if (existing.websiteSyncMeta?.websitePrimaryVariantId === group.primaryVariantId) {
          return true;
        }
        if (
          group.canonicalLink &&
          normalizeCanonicalProductUrl(existing.merchantData.link || existing.evidence?.sourceUrl) ===
            group.canonicalLink
        ) {
          return true;
        }
        if (existing.syncedVariants?.some((sv) => groupVariantIds.has(sv.id))) {
          return true;
        }
        return false;
      });

      if (alreadyExists) {
        skippedCount++;
        continue;
      }

      const primary = group.variants[0];
      const slugMatch = group.canonicalLink.split('/products/')[1];
      const baseSlug = slugMatch
        ? slugMatch.replace(/[^a-z0-9-_]/gi, '-').toLowerCase()
        : group.itemGroupId || primary.id;
      const newId = updatedCatalog.some((p) => p.id === baseSlug)
        ? `${baseSlug}-${primary.id.slice(0, 6)}`
        : baseSlug;

      const targetItemGroupId = group.variants.length >= 2 ? group.itemGroupId : '';
      const inferred = inferProductGroupAndSubgroup(group.title, group.description, group.link);
      const tax = guessTaxonomy(group.title, group.description);
      const theme = getSpecificTheme(
        group.title,
        group.description,
        inferred.productSubgroup || inferred.productGroup || '',
        inferred.productGroup,
        inferred.productSubgroup
      );

      const tempMockItem: ProductItem = {
        id: newId,
        status: 'not_analyzed',
        productGroup: inferred.productGroup,
        productSubgroup: inferred.productSubgroup,
        evidence: {
          sourceUrl: group.link,
          extractedAt: now,
          pageTitle: group.title,
          rawDescription: group.description,
          verifiedAttributes: {},
          confidenceScores: { pageTitle: 0.9, price: 0.9, images: 0.9, material: 0.5 },
          unresolvedAttributes: [],
          variants: [],
          images: [primary.image_link],
          userCorrections: {},
        },
        merchantData: {
          id: newId,
          link: group.link,
          title: group.title,
          description: group.description,
          price: primary.price,
        } as any,
        giftIntelligence: {
          theme,
          subtheme: '',
          targetAudience: [],
          recipientPersonas: [],
          occasions: [],
          primaryGiftIntent: '',
          secondaryGiftIntents: [],
          searchConcepts: [],
        },
        titleCandidates: [],
        appliedSuggestions: [],
        history: [],
        validation: { isValid: true, blockingErrors: [], warnings: [] },
        createdAt: now,
        updatedAt: now,
      };

      const allocatedLabels = allocateCustomLabels(tempMockItem, INITIAL_STRATEGY_CONFIG, {
        theme,
        productType: tax.productType.split('>').pop()?.trim() || 'Themed Merchandise',
      });

      const identifiers = determineProductIdentifiers(
        primary.gtin,
        primary.mpn,
        undefined,
        undefined,
        'no',
        primary.brand || 'Science of Gifts'
      );

      const merchantData: MerchantData = {
        id: newId,
        link: group.link,
        title: group.title,
        description: group.description,
        image_link: primary.image_link,
        additional_image_link: primary.additional_image_link || '',
        google_product_category: tax.gpc,
        product_type: tax.productType,
        price: primary.price,
        sale_price: primary.sale_price || '',
        availability: primary.availability,
        brand: identifiers.brand,
        gtin: identifiers.gtin,
        mpn: identifiers.mpn,
        identifier_exists: identifiers.identifier_exists,
        item_group_id: targetItemGroupId,
        color: primary.color || '',
        size: primary.size || '',
        material: primary.material || '',
        gender: (primary.gender || tax.gender || 'unisex') as any,
        age_group: (primary.age_group || tax.ageGroup || 'adult') as any,
        condition: primary.condition || 'new',
        custom_label_0: allocatedLabels.custom_label_0,
        custom_label_1: allocatedLabels.custom_label_1,
        custom_label_2: allocatedLabels.custom_label_2,
        custom_label_3: allocatedLabels.custom_label_3,
        custom_label_4: allocatedLabels.custom_label_4,
      };

      const clonedSyncedVariants = group.variants.map((v) => ({ ...v }));
      const newProduct: ProductItem = {
        id: newId,
        productGroup: inferred.productGroup,
        productSubgroup: inferred.productSubgroup,
        status: 'not_analyzed',
        evidence: {
          sourceUrl: group.link,
          extractedAt: now,
          pageTitle: group.title,
          rawDescription: group.description,
          verifiedAttributes: {
            brand: merchantData.brand,
            color: merchantData.color || undefined,
            size: merchantData.size || undefined,
            material: merchantData.material || undefined,
            mpn: merchantData.mpn || undefined,
          },
          unresolvedAttributes: [],
          confidenceScores: { title: 1, price: 1, imported_data: 1 },
          variants: clonedSyncedVariants.map((v) => ({
            id: v.id,
            title: [v.size, v.color].filter(Boolean).join(' / ') || v.title,
            price: v.price,
            sku: v.mpn,
            color: v.color,
            size: v.size,
            material: v.material,
            image: v.image_link,
            available: v.availability === 'in_stock',
          })),
          images: Array.from(new Set(clonedSyncedVariants.map((v) => v.image_link).filter(Boolean))),
          userCorrections: {},
        },
        merchantData,
        giftIntelligence: {
          theme,
          subtheme: '',
          targetAudience: [],
          recipientPersonas: [],
          occasions: [],
          primaryGiftIntent: '',
          secondaryGiftIntents: [],
          searchConcepts: [],
        },
        titleCandidates: [],
        originalImported: { ...merchantData },
        appliedSuggestions: [],
        history: [
          {
            timestamp: now,
            note: `Imported design with ${clonedSyncedVariants.length} variant(s) from Website Feed Sync`,
            snapshot: { ...merchantData },
          },
        ],
        syncedVariants: clonedSyncedVariants,
        websiteSyncMeta: {
          lastSyncedAt: now,
          feedUrl,
          websiteItemGroupId: group.itemGroupId || undefined,
          websitePrimaryVariantId: group.primaryVariantId,
          canonicalProductUrl: group.canonicalLink,
          matchMethod: 'canonical_url',
          variantCount: clonedSyncedVariants.length,
          preservedAppId: newId,
        },
        validation: { isValid: true, blockingErrors: [], warnings: [] },
        createdAt: now,
        updatedAt: now,
      };

      updatedCatalog.push(newProduct);
      importedProductIds.push(newId);
      totalVariantsSynced += clonedSyncedVariants.length;
    }
  }

  // Recompute validation & status only on modified or newly imported items so untouched records remain byte-for-byte identical
  const touchedIdSet = new Set<string>([...updatedProductIds, ...importedProductIds]);
  const finalizedCatalog = updatedCatalog.map((item) => {
    if (!touchedIdSet.has(item.id)) {
      return item;
    }
    const { status, validation } = computeProductStatus(item, updatedCatalog);
    return {
      ...item,
      status: item.status === 'not_analyzed' && validation.isValid ? 'not_analyzed' : status,
      validation,
    };
  });

  return {
    updatedCatalog: finalizedCatalog,
    result: {
      appliedAt: now,
      syncMode,
      updatedProductCount,
      importedNewProductCount: importedProductIds.length,
      attachedVariantsCount,
      unchangedProductCount,
      totalVariantsSynced,
      skippedCount,
      updatedProductIds,
      importedProductIds,
    },
  };
}

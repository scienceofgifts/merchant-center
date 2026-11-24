import {
  MerchantData,
  ProductItem,
  EvidenceModel,
  GiftIntelligence,
  WebsiteVariant,
  CsvImportMode,
  CsvImportMatchMethod,
  CsvImportConflict,
  CsvImportMatchedPreview,
  CsvImportNewProductPreview,
  CsvImportPreview,
  CsvImportApplySummary,
} from '../types/feed';
import { computeProductStatus } from './validation';

export const MERCHANT_CENTER_COLUMNS = [
  'id',
  'title',
  'description',
  'link',
  'image_link',
  'additional_image_link',
  'availability',
  'price',
  'sale_price',
  'google_product_category',
  'product_type',
  'brand',
  'gtin',
  'mpn',
  'identifier_exists',
  'item_group_id',
  'color',
  'size',
  'material',
  'pattern',
  'gender',
  'age_group',
  'condition',
  'size_type',
  'custom_label_0',
  'custom_label_1',
  'custom_label_2',
  'custom_label_3',
  'custom_label_4',
] as const;

export function escapeCsvField(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export type IdentifierClassification =
  | 'genuine_gtin'
  | 'genuine_mpn'
  | 'internal_fulfillment_sku'
  | 'no_identifiers'
  | 'uncertain_provenance';

export interface ResolvedIdentifiers {
  identifier_exists: 'yes' | 'no';
  gtin: string;
  mpn: string;
  brand: string;
  classification: IdentifierClassification;
  needsReview: boolean;
  reviewReason?: string;
}

/**
 * Validates whether a value is a genuine GS1 GTIN barcode (UPC, EAN, JAN, ISBN: 8, 12, 13, 14 numeric digits).
 * Strictly enforces the official GS1 Modulo-10 check digit algorithm and rejects dummy/placeholder values.
 */
export function isValidGtin(gtin?: string): boolean {
  if (!gtin) return false;
  const clean = gtin.trim().replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(clean.length)) return false;
  if (/^0+$/.test(clean) || /^12345678/.test(clean)) return false;

  const digits = clean.split('').map(Number);
  const checkDigit = digits.pop()!;
  let sum = 0;
  let weight = 3;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += digits[i] * weight;
    weight = weight === 3 ? 1 : 3;
  }
  const expectedCheckDigit = (10 - (sum % 10)) % 10;
  return checkDigit === expectedCheckDigit;
}

/**
 * Checks if an identifier matches known internal platform or fulfillment SKU patterns rather than an OEM MPN.
 * Fourthwall variant SKUs (e.g. ZM2K-TX7200S), generic internal prefixes (mpn-, uuid-, sku-), and pure numeric IDs
 * represent store database identifiers, not genuine manufacturer part numbers.
 */
export function isInternalFulfillmentSku(mpn?: string): boolean {
  if (!mpn) return false;
  const clean = mpn.trim();
  if (!clean) return false;
  // Fourthwall print-on-demand variant SKU pattern: Z followed by 3 alphanumeric chars, hyphen, and 5-8 chars (e.g. ZM2K-TX7200S)
  if (/^Z[A-Z0-9]{3}-[A-Z0-9]{5,8}$/i.test(clean)) return true;
  // Generic test/internal SKU prefixes
  if (/^(mpn|uuid|sku|item|test|variant|inv|fw|pod)[-_]/i.test(clean)) return true;
  // Database internal sequence IDs
  if (/^\d{8,16}$/.test(clean)) return true;
  return false;
}

/**
 * Validates whether an MPN is a genuine manufacturer-assigned part number.
 * An MPN is genuine if it is non-empty, between 1 and 70 characters, not an internal SKU,
 * and supported by manufacturer provenance or verified catalog assertion.
 */
export function isGenuineMpn(mpn?: string, hasVerifiedProvenance: boolean = true): boolean {
  if (!mpn) return false;
  const clean = mpn.trim();
  if (!clean || clean.length < 3 || clean.length > 70) return false;
  if (isInternalFulfillmentSku(clean)) return false;
  return hasVerifiedProvenance;
}

/**
 * Evaluates and resolves policy-compliant Google Merchant Center product identifiers across 5 distinct categories:
 * 1. Genuine GTIN (valid GS1 Modulo-10 barcode) -> identifier_exists='yes', gtin submitted
 * 2. Genuine OEM MPN (provenance-verified manufacturer part number) -> identifier_exists='yes', mpn submitted
 * 3. Internal Fulfillment SKU (e.g. Fourthwall ZM2K-... SKUs) -> identifier_exists='no', gtin/mpn omitted
 * 4. Uncertain Provenance (unverified string) -> identifier_exists='no', flagged for manual review
 * 5. No Known Identifiers (custom/POD items without identifiers) -> identifier_exists='no', gtin/mpn omitted
 */
export function determineProductIdentifiers(
  variantGtin?: string,
  variantMpn?: string,
  catalogGtin?: string,
  catalogMpn?: string,
  catalogIdentifierExists?: string,
  brand?: string,
  hasVerifiedMpnProvenance?: boolean
): ResolvedIdentifiers {
  const cleanBrand = (brand || 'Science of Gifts').trim() || 'Science of Gifts';
  const rawGtin = (variantGtin || catalogGtin || '').trim();
  const rawMpn = (variantMpn || catalogMpn || '').trim();

  // 1. Valid GS1 GTIN present with valid checksum
  if (isValidGtin(rawGtin)) {
    const isMpnGenuine = Boolean(
      rawMpn &&
      !isInternalFulfillmentSku(rawMpn) &&
      (hasVerifiedMpnProvenance ?? (catalogIdentifierExists === 'yes'))
    );
    return {
      identifier_exists: 'yes',
      gtin: rawGtin.replace(/\D/g, ''),
      mpn: isMpnGenuine ? rawMpn : '',
      brand: cleanBrand,
      classification: 'genuine_gtin',
      needsReview: false,
    };
  }

  // 2. Genuine OEM MPN present AND explicitly confirmed by catalog/user assertion
  const isMpnGenuine = Boolean(
    rawMpn &&
    !isInternalFulfillmentSku(rawMpn) &&
    (hasVerifiedMpnProvenance ?? (catalogIdentifierExists === 'yes'))
  );
  if (catalogIdentifierExists === 'yes' && isMpnGenuine) {
    return {
      identifier_exists: 'yes',
      gtin: '',
      mpn: rawMpn,
      brand: cleanBrand,
      classification: 'genuine_mpn',
      needsReview: false,
    };
  }

  // 3. Raw MPN present but identified as internal platform/fulfillment SKU (e.g. Fourthwall POD variant SKU)
  if (rawMpn && isInternalFulfillmentSku(rawMpn)) {
    return {
      identifier_exists: 'no',
      gtin: '',
      mpn: '',
      brand: cleanBrand,
      classification: 'internal_fulfillment_sku',
      needsReview: false,
    };
  }

  // 4. Raw MPN present without verified OEM provenance or known SKU pattern -> flag as uncertain
  if (rawMpn && !isInternalFulfillmentSku(rawMpn) && catalogIdentifierExists !== 'yes') {
    return {
      identifier_exists: 'no',
      gtin: '',
      mpn: '',
      brand: cleanBrand,
      classification: 'uncertain_provenance',
      needsReview: true,
      reviewReason: `Identifier "${rawMpn}" provided without verified manufacturer provenance. Omitted from feed and marked identifier_exists='no' pending manual verification.`,
    };
  }

  // 5. Custom / Print-on-Demand / Bespoke goods with no identifiers
  return {
    identifier_exists: 'no',
    gtin: '',
    mpn: '',
    brand: cleanBrand,
    classification: 'no_identifiers',
    needsReview: false,
  };
}

export function expandCatalogToExportRows(items: ProductItem[]): MerchantData[] {
  const expandedRows: MerchantData[] = [];

  for (const item of items) {
    const d = item.merchantData;
    const synced = item.syncedVariants;

    if (synced && synced.length >= 2) {
      const sharedGroupId = (
        synced[0].item_group_id ||
        item.websiteSyncMeta?.websiteItemGroupId ||
        d.item_group_id ||
        item.id
      ).trim();

      for (const variant of synced) {
        const hasVerifiedMpn = Boolean(
          item.evidence?.verifiedAttributes?.mpn ||
          (variant.identifier_exists === 'yes' && variant.mpn && !isInternalFulfillmentSku(variant.mpn))
        );
        const identifiers = determineProductIdentifiers(
          variant.gtin,
          variant.mpn,
          d.gtin,
          d.mpn,
          variant.identifier_exists || d.identifier_exists,
          variant.brand || d.brand,
          hasVerifiedMpn
        );

        expandedRows.push({
          ...d,
          id: (variant.id || d.id).trim(),
          item_group_id: sharedGroupId,
          // Strictly preserve catalog product's custom title, description, taxonomy, and custom labels
          title: d.title,
          description: d.description,
          google_product_category: d.google_product_category,
          product_type: d.product_type,
          custom_label_0: d.custom_label_0,
          custom_label_1: d.custom_label_1,
          custom_label_2: d.custom_label_2,
          custom_label_3: d.custom_label_3,
          custom_label_4: d.custom_label_4,
          // Use variant-specific commerce & attribute facts from synced variant
          link: variant.link || d.link,
          image_link: variant.image_link || d.image_link,
          additional_image_link: variant.additional_image_link ?? d.additional_image_link ?? '',
          availability: variant.availability || d.availability,
          price: variant.price || d.price,
          sale_price: variant.sale_price ?? d.sale_price ?? '',
          brand: identifiers.brand,
          gtin: identifiers.gtin,
          mpn: identifiers.mpn,
          identifier_exists: identifiers.identifier_exists,
          color: variant.color || d.color || '',
          size: variant.size || d.size || '',
          size_type: variant.size_type ?? d.size_type ?? '',
          material: variant.material || d.material || '',
          pattern: variant.pattern ?? d.pattern ?? '',
          gender: variant.gender || d.gender || '',
          age_group: variant.age_group || d.age_group || '',
          condition: variant.condition || d.condition || 'new',
        });
      }
    } else if (synced && synced.length === 1) {
      // Single-variant synced product: 1 row, no fabricated variants, empty item_group_id
      const variant = synced[0];
      const hasVerifiedMpn = Boolean(
        item.evidence?.verifiedAttributes?.mpn ||
        (variant.identifier_exists === 'yes' && variant.mpn && !isInternalFulfillmentSku(variant.mpn))
      );
      const identifiers = determineProductIdentifiers(
        variant.gtin,
        variant.mpn,
        d.gtin,
        d.mpn,
        variant.identifier_exists || d.identifier_exists,
        variant.brand || d.brand,
        hasVerifiedMpn
      );

      expandedRows.push({
        ...d,
        id: (variant.id || d.id).trim(),
        item_group_id: '', // Single variant must not carry an orphan item_group_id
        title: d.title,
        description: d.description,
        google_product_category: d.google_product_category,
        product_type: d.product_type,
        custom_label_0: d.custom_label_0,
        custom_label_1: d.custom_label_1,
        custom_label_2: d.custom_label_2,
        custom_label_3: d.custom_label_3,
        custom_label_4: d.custom_label_4,
        link: variant.link || d.link,
        image_link: variant.image_link || d.image_link,
        additional_image_link: variant.additional_image_link ?? d.additional_image_link ?? '',
        availability: variant.availability || d.availability,
        price: variant.price || d.price,
        sale_price: variant.sale_price ?? d.sale_price ?? '',
        brand: identifiers.brand,
        gtin: identifiers.gtin,
        mpn: identifiers.mpn,
        identifier_exists: identifiers.identifier_exists,
        color: variant.color || d.color || '',
        size: variant.size || d.size || '',
        size_type: variant.size_type ?? d.size_type ?? '',
        material: variant.material || d.material || '',
        pattern: variant.pattern ?? d.pattern ?? '',
        gender: variant.gender || d.gender || '',
        age_group: variant.age_group || d.age_group || '',
        condition: variant.condition || d.condition || 'new',
      });
    } else {
      // Unsynced catalog product
      const hasVerifiedMpn = Boolean(item.evidence?.verifiedAttributes?.mpn);
      const identifiers = determineProductIdentifiers(
        undefined,
        undefined,
        d.gtin,
        d.mpn,
        d.identifier_exists,
        d.brand,
        hasVerifiedMpn
      );

      expandedRows.push({
        ...d,
        brand: identifiers.brand,
        gtin: identifiers.gtin,
        mpn: identifiers.mpn,
        identifier_exists: identifiers.identifier_exists,
      });
    }
  }

  // Count occurrences of each non-empty item_group_id across all expanded rows
  const groupCounts = new Map<string, number>();
  for (const row of expandedRows) {
    const gid = (row.item_group_id || '').trim();
    if (gid) {
      groupCounts.set(gid, (groupCounts.get(gid) || 0) + 1);
    }
  }

  // Strip orphan item_group_id (must be shared by 2+ exported variant rows)
  for (const row of expandedRows) {
    const gid = (row.item_group_id || '').trim();
    if (!gid || (groupCounts.get(gid) || 0) < 2) {
      row.item_group_id = '';
    } else {
      row.item_group_id = gid;
    }
  }

  return expandedRows;
}

export interface ExportFeedValidationSummary {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  totalCatalogDesigns: number;
  totalExportedVariantRows: number;
  multiVariantDesignCount: number;
  singleVariantDesignCount: number;
}

export function validateExportedFeedRows(items: ProductItem[]): ExportFeedValidationSummary {
  const expandedRows = expandCatalogToExportRows(items);
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();
  const groupCounts = new Map<string, number>();

  for (const row of expandedRows) {
    const id = (row.id || '').trim();
    if (!id) {
      errors.push(`Exported variant row for "${row.title || 'Unknown'}" is missing required id.`);
    } else if (seenIds.has(id)) {
      errors.push(`Duplicate exported variant ID "${id}" detected.`);
    } else {
      seenIds.add(id);
    }

    if (!row.title || !row.title.trim()) {
      errors.push(`Variant "${id}" is missing required title.`);
    } else if (row.title.length > 150) {
      warnings.push(`Variant "${id}" title exceeds 150 characters (${row.title.length} chars).`);
    }

    if (!row.description || !row.description.trim()) {
      errors.push(`Variant "${id}" is missing required description.`);
    } else if (row.description.length > 5000) {
      warnings.push(`Variant "${id}" description exceeds 5000 characters (${row.description.length} chars).`);
    }

    if (!row.link || !row.link.trim()) {
      errors.push(`Variant "${id}" is missing required link.`);
    } else if (!/^https?:\/\//i.test(row.link.trim())) {
      errors.push(`Variant "${id}" has invalid link "${row.link}".`);
    }

    if (!row.image_link || !row.image_link.trim()) {
      errors.push(`Variant "${id}" is missing required image_link.`);
    } else if (!/^https?:\/\//i.test(row.image_link.trim())) {
      errors.push(`Variant "${id}" has invalid image_link "${row.image_link}".`);
    }

    if (!row.price || !row.price.trim()) {
      errors.push(`Variant "${id}" is missing required price.`);
    } else if (!/^\d+(\.\d{2})?\s+[A-Z]{3}$/.test(row.price.trim())) {
      errors.push(`Variant "${id}" price "${row.price}" does not match required format (e.g. "26.00 USD").`);
    }

    const validAvailabilities = ['in_stock', 'out_of_stock', 'preorder', 'backorder'];
    if (!row.availability || !validAvailabilities.includes(row.availability)) {
      errors.push(`Variant "${id}" has invalid availability "${row.availability}".`);
    }

    // Google taxonomy check
    if (row.google_product_category && row.google_product_category.toLowerCase().includes('gifts >')) {
      errors.push(`Variant "${id}" google_product_category contains "Gifts >". Must use official Google Product Taxonomy.`);
    }

    // Identifiers compliance checks
    if (row.identifier_exists === 'no') {
      if (row.gtin && row.gtin.trim()) {
        errors.push(`Variant "${id}" has identifier_exists='no' but gtin is populated ("${row.gtin}").`);
      }
      if (row.mpn && row.mpn.trim()) {
        errors.push(`Variant "${id}" has identifier_exists='no' but mpn is populated ("${row.mpn}").`);
      }
    } else if (row.identifier_exists === 'yes') {
      if (!row.gtin && !row.mpn) {
        errors.push(`Variant "${id}" has identifier_exists='yes' but neither GTIN nor MPN is provided.`);
      }
    } else {
      errors.push(`Variant "${id}" has invalid identifier_exists "${row.identifier_exists}". Must be "yes" or "no".`);
    }

    const gid = (row.item_group_id || '').trim();
    if (gid) {
      groupCounts.set(gid, (groupCounts.get(gid) || 0) + 1);
    }
  }

  for (const [gid, count] of groupCounts.entries()) {
    if (count < 2) {
      errors.push(`item_group_id "${gid}" appears on only ${count} row(s); must be shared by at least 2 variants.`);
    }
  }

  // Verify each multi-variant catalog item has consistent item_group_id across its variants
  let multiVariantDesignCount = 0;
  let singleVariantDesignCount = 0;
  for (const item of items) {
    if (item.syncedVariants && item.syncedVariants.length >= 2) {
      multiVariantDesignCount++;
      const gids = new Set(
        item.syncedVariants.map((v) =>
          (v.item_group_id || item.websiteSyncMeta?.websiteItemGroupId || item.merchantData.item_group_id || item.id).trim()
        )
      );
      if (gids.size !== 1 || gids.has('')) {
        errors.push(`Product "${item.id}" has inconsistent or empty item_group_id across its ${item.syncedVariants.length} variants.`);
      }
    } else {
      singleVariantDesignCount++;
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    totalCatalogDesigns: items.length,
    totalExportedVariantRows: expandedRows.length,
    multiVariantDesignCount,
    singleVariantDesignCount,
  };
}

export function generateMerchantCenterCsv(items: ProductItem[]): string {
  const headers = [...MERCHANT_CENTER_COLUMNS];
  const rows: string[] = [];
  const expandedRows = expandCatalogToExportRows(items);

  rows.push(headers.join(','));

  for (const d of expandedRows) {
    const rowValues = headers.map((col) => {
      const val = (d as any)[col] ?? '';
      return escapeCsvField(val);
    });
    rows.push(rowValues.join(','));
  }

  return rows.join('\r\n');
}

function escapeXmlText(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapCdata(val: string): string {
  const safe = (val || '').replace(/\]\]>/g, ']]]]><![CDATA[>');
  return `<![CDATA[${safe}]]>`;
}

export function generateMerchantCenterRssXml(items: ProductItem[]): string {
  const expandedRows = expandCatalogToExportRows(items);
  const itemBlocks = expandedRows.map((d) => {
    const availabilityRss = d.availability === 'in_stock'
      ? 'in stock'
      : d.availability === 'out_of_stock'
        ? 'out of stock'
        : d.availability;
    const tags: string[] = [
      `<g:id>${escapeXmlText(d.id)}</g:id>`,
    ];
    if (d.item_group_id) {
      tags.push(`<g:item_group_id>${escapeXmlText(d.item_group_id)}</g:item_group_id>`);
    }
    tags.push(`<g:title>${wrapCdata(d.title)}</g:title>`);
    tags.push(`<g:description>${wrapCdata(d.description)}</g:description>`);
    tags.push(`<g:link>${escapeXmlText(d.link)}</g:link>`);
    tags.push(`<g:image_link>${escapeXmlText(d.image_link)}</g:image_link>`);
    if (d.additional_image_link) {
      tags.push(`<g:additional_image_link>${escapeXmlText(d.additional_image_link)}</g:additional_image_link>`);
    }
    tags.push(`<g:availability>${escapeXmlText(availabilityRss)}</g:availability>`);
    tags.push(`<g:price>${escapeXmlText(d.price)}</g:price>`);
    if (d.sale_price) {
      tags.push(`<g:sale_price>${escapeXmlText(d.sale_price)}</g:sale_price>`);
    }
    if (d.google_product_category) {
      tags.push(`<g:google_product_category>${escapeXmlText(d.google_product_category)}</g:google_product_category>`);
    }
    if (d.product_type) {
      tags.push(`<g:product_type>${escapeXmlText(d.product_type)}</g:product_type>`);
    }
    tags.push(`<g:brand>${wrapCdata(d.brand || 'Science of Gifts')}</g:brand>`);
    if (d.identifier_exists === 'yes') {
      if (d.gtin) {
        tags.push(`<g:gtin>${escapeXmlText(d.gtin)}</g:gtin>`);
      }
      if (d.mpn) {
        tags.push(`<g:mpn>${escapeXmlText(d.mpn)}</g:mpn>`);
      }
    }
    tags.push(`<g:identifier_exists>${escapeXmlText(d.identifier_exists || 'no')}</g:identifier_exists>`);
    if (d.color) {
      tags.push(`<g:color>${escapeXmlText(d.color)}</g:color>`);
    }
    if (d.size) {
      tags.push(`<g:size>${escapeXmlText(d.size)}</g:size>`);
    }
    if (d.material) {
      tags.push(`<g:material>${escapeXmlText(d.material)}</g:material>`);
    }
    if (d.gender) {
      tags.push(`<g:gender>${escapeXmlText(d.gender)}</g:gender>`);
    }
    if (d.age_group) {
      tags.push(`<g:age_group>${escapeXmlText(d.age_group)}</g:age_group>`);
    }
    tags.push(`<g:condition>${escapeXmlText(d.condition || 'new')}</g:condition>`);
    if (d.custom_label_0) tags.push(`<g:custom_label_0>${escapeXmlText(d.custom_label_0)}</g:custom_label_0>`);
    if (d.custom_label_1) tags.push(`<g:custom_label_1>${escapeXmlText(d.custom_label_1)}</g:custom_label_1>`);
    if (d.custom_label_2) tags.push(`<g:custom_label_2>${escapeXmlText(d.custom_label_2)}</g:custom_label_2>`);
    if (d.custom_label_3) tags.push(`<g:custom_label_3>${escapeXmlText(d.custom_label_3)}</g:custom_label_3>`);
    if (d.custom_label_4) tags.push(`<g:custom_label_4>${escapeXmlText(d.custom_label_4)}</g:custom_label_4>`);

    return `<item>${tags.join('')}</item>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?><rss xmlns:g="http://base.google.com/ns/1.0" version="2.0"><channel><g:title><![CDATA[Science of Gifts]]></g:title><g:link>https://shop.scienceofgifts.com</g:link><g:description><![CDATA[Science of Gifts]]></g:description>${itemBlocks.join('')}</channel></rss>`;
}

export function parseCsvText(csvText: string): Array<Record<string, string>> {
  const cleanText = csvText.replace(/^\uFEFF/, '').trim();
  if (!cleanText) return [];

  const firstLine = cleanText.split(/\r?\n/, 1)[0] || '';
  const delimiter = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const lines: string[][] = [];
  let currentLine: string[] = [];
  let currentField = '';
  let insideQuote = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (insideQuote) {
      if (char === '"' && nextChar === '"') {
        currentField += '"';
        i++; // skip next quote
      } else if (char === '"') {
        insideQuote = false;
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        insideQuote = true;
      } else if (char === delimiter) {
        currentLine.push(currentField.trim());
        currentField = '';
      } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        currentLine.push(currentField.trim());
        lines.push(currentLine);
        currentLine = [];
        currentField = '';
        if (char === '\r') i++;
      } else {
        currentField += char;
      }
    }
  }

  if (currentField || currentLine.length > 0) {
    currentLine.push(currentField.trim());
    lines.push(currentLine);
  }

  if (lines.length < 2) return [];

  const headerRow = lines[0].map((h) =>
    h
      .replace(/^\uFEFF/, '')
      .toLowerCase()
      .trim()
      .replace(/^g:/, '')
      .replace(/[\s-]+/g, '_')
  );
  const results: Array<Record<string, string>> = [];

  for (let r = 1; r < lines.length; r++) {
    const row = lines[r];
    if (row.length === 0 || (row.length === 1 && row[0] === '')) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headerRow.length; c++) {
      const headerKey = headerRow[c];
      if (!headerKey) continue;
      obj[headerKey] = row[c] !== undefined ? row[c] : '';
    }
    results.push(obj);
  }

  return results;
}

/**
 * Validates and sanitizes an HTTP/HTTPS URL, rejecting dangerous schemes (javascript:, data:, vbscript:, file:).
 */
export function sanitizeHttpUrl(rawUrl?: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return trimmed;
  } catch {
    return '';
  }
}

/**
 * Normalizes a product URL to a canonical form (stripping locale prefixes like /en-usd/, query strings,
 * hash fragments, www prefix, trailing slashes, and known Fourthwall storefront domain aliases).
 */
export function normalizeCanonicalProductUrl(rawUrl?: string): string {
  if (!rawUrl || !rawUrl.trim()) return '';
  const trimmed = rawUrl.trim();
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const canonicalHost =
      host === 'scienceofgifts.fourthwall.com' ? 'shop.scienceofgifts.com' : host;
    let pathname = parsed.pathname.replace(/\/+$/, '');
    // Strip locale segments like /en-usd/products/... or /en-us/products/...
    pathname = pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2,3})?(\/products\/)/i, '$1');
    return `https://${canonicalHost}${pathname.toLowerCase()}`;
  } catch {
    return '';
  }
}

function isSpecificProductUrl(canonicalUrl: string): boolean {
  if (!canonicalUrl) return false;
  try {
    const parsed = new URL(canonicalUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    if (!cleanPath || cleanPath === '/') return false;
    // Generic non-product root/collection endpoints must not be used to merge distinct products
    if (
      cleanPath === '/products' ||
      cleanPath === '/shop' ||
      cleanPath === '/store' ||
      cleanPath === '/collections' ||
      cleanPath === '/collections/all'
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeItemGroupId(raw?: string): string {
  const clean = (raw || '').trim();
  if (!clean) return '';
  if (/^(n\/a|na|none|null|undefined|-|0)$/i.test(clean)) return '';
  return clean;
}

function normalizeCsvAvailability(raw?: string): 'in_stock' | 'out_of_stock' | 'preorder' | 'backorder' {
  const clean = (raw || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (clean === 'in_stock' || clean === 'instock') return 'in_stock';
  if (clean === 'out_of_stock' || clean === 'outofstock') return 'out_of_stock';
  if (clean === 'preorder' || clean === 'pre_order') return 'preorder';
  if (clean === 'backorder' || clean === 'back_order') return 'backorder';
  return 'in_stock';
}

function normalizeCsvGender(raw?: string): 'unisex' | 'male' | 'female' | '' {
  const clean = (raw || '').trim().toLowerCase();
  if (clean === 'unisex' || clean === 'male' || clean === 'female') return clean;
  return '';
}

function normalizeCsvAgeGroup(raw?: string): 'adult' | 'all_ages' | 'teen' | 'kids' | 'toddler' | 'infant' | '' {
  const clean = (raw || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['adult', 'all_ages', 'teen', 'kids', 'toddler', 'infant'].includes(clean)) {
    return clean as any;
  }
  return '';
}

function normalizeCsvSizeType(raw?: string): 'regular' | 'petite' | 'plus' | 'big_and_tall' | 'maternity' | '' {
  const clean = (raw || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['regular', 'petite', 'plus', 'big_and_tall', 'maternity'].includes(clean)) {
    return clean as any;
  }
  return '';
}

function normalizeCsvCondition(raw?: string): 'new' | 'refurbished' | 'used' {
  const clean = (raw || '').trim().toLowerCase();
  if (clean === 'refurbished' || clean === 'used') return clean;
  return 'new';
}

function normalizeCsvIdentifierExists(raw?: string, gtin?: string, mpn?: string): 'yes' | 'no' {
  const clean = (raw || '').trim().toLowerCase();
  if (clean === 'yes' || clean === 'true') return 'yes';
  if (clean === 'no' || clean === 'false') return 'no';
  return gtin || mpn ? 'yes' : 'no';
}

function extractBaseTitleForGrouping(title?: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/\s*[-–|/,]\s*(xxs|xs|s|m|l|xl|2xl|3xl|4xl|5xl|small|medium|large|x-large|xx-large|11\s*oz|15\s*oz|one size)\b.*$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const KNOWN_CSV_COLUMNS = new Set<string>([
  'id',
  'item_id',
  'sku',
  'title',
  'product_title',
  'name',
  'description',
  'desc',
  'link',
  'url',
  'product_url',
  'image_link',
  'image',
  'image_url',
  'additional_image_link',
  'availability',
  'quantity',
  'price',
  'sale_price',
  'google_product_category',
  'category',
  'product_type',
  'brand',
  'gtin',
  'mpn',
  'identifier_exists',
  'item_group_id',
  'color',
  'size',
  'size_type',
  'material',
  'pattern',
  'gender',
  'age_group',
  'condition',
  'shipping_weight',
  'custom_label_0',
  'custom_label_1',
  'custom_label_2',
  'custom_label_3',
  'custom_label_4',
]);

interface NormalizedCsvRow {
  rowIndex: number; // 1-based data row index
  variant: WebsiteVariant;
  canonicalUrl: string;
  rawItemGroupId: string;
  google_product_category: string;
  product_type: string;
  custom_label_0: string;
  custom_label_1: string;
  custom_label_2: string;
  custom_label_3: string;
  custom_label_4: string;
}

export interface CsvProductGroup {
  groupKey: string;
  proposedProductId: string;
  rawItemGroupId: string;
  effectiveItemGroupId: string;
  primaryVariantId: string;
  canonicalUrl: string;
  hasConflictingGroupId: boolean;
  hasConflictingUrl: boolean;
  rows: NormalizedCsvRow[];
  variants: WebsiteVariant[];
  product: ProductItem;
}

export interface CsvGroupingResult {
  totalCsvRows: number;
  totalVariants: number;
  duplicateVariantRowsDeduplicated: number;
  groups: CsvProductGroup[];
  products: ProductItem[];
  conflicts: CsvImportConflict[];
}

function normalizeCsvRow(row: Record<string, string>, index: number): NormalizedCsvRow {
  const rawLink = row.link || row.url || row.product_url || '';
  const link = sanitizeHttpUrl(rawLink);
  const canonicalUrl = normalizeCanonicalProductUrl(link);
  const title = (row.title || row.product_title || row.name || '').trim();
  const description = (row.description || row.desc || '').trim();
  const imageLink = sanitizeHttpUrl(row.image_link || row.image || row.image_url || '');
  const additionalImageLink = sanitizeHttpUrl(row.additional_image_link || '');
  const price = (row.price || '').trim();
  const salePrice = (row.sale_price || '').trim();
  const availability = normalizeCsvAvailability(row.availability);
  const brand = (row.brand || '').trim() || 'Science of Gifts';
  const gtin = (row.gtin || '').trim();
  const mpn = (row.mpn || '').trim();
  const identifierExists = normalizeCsvIdentifierExists(row.identifier_exists, gtin, mpn);
  const rawItemGroupId = normalizeItemGroupId(row.item_group_id);
  const color = (row.color || '').trim();
  const size = (row.size || '').trim();
  const sizeType = normalizeCsvSizeType(row.size_type);
  const material = (row.material || '').trim();
  const pattern = (row.pattern || '').trim();
  const gender = normalizeCsvGender(row.gender);
  const ageGroup = normalizeCsvAgeGroup(row.age_group);
  const condition = normalizeCsvCondition(row.condition);
  const shippingWeight = (row.shipping_weight || '').trim();
  const parsedQty = row.quantity && row.quantity.trim() !== '' ? parseInt(row.quantity.trim(), 10) : undefined;

  const explicitId = (row.id || row.item_id || row.sku || '').trim();
  const variantId =
    explicitId ||
    `csv_${fnv1aHash(`${canonicalUrl}|${rawItemGroupId}|${title}|${color}|${size}|${material}|${price}`)}`;

  const extraAttributes: Record<string, string> = {};
  for (const [key, val] of Object.entries(row)) {
    if (!KNOWN_CSV_COLUMNS.has(key) && val && val.trim() !== '') {
      extraAttributes[key] = val.trim();
    }
  }

  const variant: WebsiteVariant = {
    id: variantId,
    item_group_id: rawItemGroupId,
    title,
    description,
    link,
    image_link: imageLink,
    additional_image_link: additionalImageLink || undefined,
    availability,
    quantity: parsedQty !== undefined && !isNaN(parsedQty) ? parsedQty : undefined,
    price,
    sale_price: salePrice || undefined,
    brand,
    mpn: mpn || undefined,
    gtin: gtin || undefined,
    identifier_exists: identifierExists,
    color: color || undefined,
    size: size || undefined,
    size_type: sizeType || undefined,
    material: material || undefined,
    pattern: pattern || undefined,
    gender: gender || undefined,
    age_group: ageGroup || undefined,
    condition,
    shipping_weight: shippingWeight || undefined,
    extraAttributes: Object.keys(extraAttributes).length > 0 ? extraAttributes : undefined,
  };

  return {
    rowIndex: index + 1,
    variant,
    canonicalUrl,
    rawItemGroupId,
    google_product_category: (row.google_product_category || row.category || '').trim(),
    product_type: (row.product_type || '').trim(),
    custom_label_0: (row.custom_label_0 || '').trim(),
    custom_label_1: (row.custom_label_1 || '').trim(),
    custom_label_2: (row.custom_label_2 || '').trim(),
    custom_label_3: (row.custom_label_3 || '').trim(),
    custom_label_4: (row.custom_label_4 || '').trim(),
  };
}

function mergeVariantNonBlank(existing: WebsiteVariant, incoming: WebsiteVariant, overwriteFactual: boolean): WebsiteVariant {
  const pick = <T extends string | number | undefined>(cur: T, inc: T): T => {
    const curFilled = cur !== undefined && cur !== '';
    const incFilled = inc !== undefined && inc !== '';
    if (overwriteFactual) {
      return incFilled ? inc : cur;
    }
    return curFilled ? cur : inc;
  };

  const mergedExtra =
    existing.extraAttributes || incoming.extraAttributes
      ? {
          ...(overwriteFactual ? existing.extraAttributes : incoming.extraAttributes),
          ...(overwriteFactual ? incoming.extraAttributes : existing.extraAttributes),
        }
      : undefined;

  return {
    id: existing.id,
    item_group_id: pick(existing.item_group_id, incoming.item_group_id) || '',
    title: pick(existing.title, incoming.title) || '',
    description: pick(existing.description, incoming.description) || '',
    link: pick(existing.link, incoming.link) || '',
    image_link: pick(existing.image_link, incoming.image_link) || '',
    additional_image_link: pick(existing.additional_image_link, incoming.additional_image_link),
    availability: (pick(existing.availability, incoming.availability) || 'in_stock') as WebsiteVariant['availability'],
    quantity: pick(existing.quantity, incoming.quantity),
    price: pick(existing.price, incoming.price) || '',
    sale_price: pick(existing.sale_price, incoming.sale_price),
    brand: pick(existing.brand, incoming.brand),
    mpn: pick(existing.mpn, incoming.mpn),
    gtin: pick(existing.gtin, incoming.gtin),
    identifier_exists: pick(existing.identifier_exists, incoming.identifier_exists),
    color: pick(existing.color, incoming.color),
    size: pick(existing.size, incoming.size),
    size_type: pick(existing.size_type, incoming.size_type),
    material: pick(existing.material, incoming.material),
    pattern: pick(existing.pattern, incoming.pattern),
    gender: pick(existing.gender, incoming.gender),
    age_group: pick(existing.age_group, incoming.age_group),
    condition: (pick(existing.condition, incoming.condition) || 'new') as WebsiteVariant['condition'],
    shipping_weight: pick(existing.shipping_weight, incoming.shipping_weight),
    extraAttributes: mergedExtra && Object.keys(mergedExtra).length > 0 ? mergedExtra : undefined,
  };
}

function areSyncedVariantsEqual(a?: WebsiteVariant[], b?: WebsiteVariant[]): boolean {
  const listA = a || [];
  const listB = b || [];
  if (listA.length !== listB.length) return false;
  for (let i = 0; i < listA.length; i++) {
    const va = listA[i];
    const vb = listB[i];
    if (
      va.id !== vb.id ||
      (va.item_group_id || '') !== (vb.item_group_id || '') ||
      (va.title || '') !== (vb.title || '') ||
      (va.description || '') !== (vb.description || '') ||
      (va.link || '') !== (vb.link || '') ||
      (va.image_link || '') !== (vb.image_link || '') ||
      (va.additional_image_link || '') !== (vb.additional_image_link || '') ||
      va.availability !== vb.availability ||
      va.quantity !== vb.quantity ||
      (va.price || '') !== (vb.price || '') ||
      (va.sale_price || '') !== (vb.sale_price || '') ||
      (va.brand || '') !== (vb.brand || '') ||
      (va.mpn || '') !== (vb.mpn || '') ||
      (va.gtin || '') !== (vb.gtin || '') ||
      (va.identifier_exists || '') !== (vb.identifier_exists || '') ||
      (va.color || '') !== (vb.color || '') ||
      (va.size || '') !== (vb.size || '') ||
      (va.size_type || '') !== (vb.size_type || '') ||
      (va.material || '') !== (vb.material || '') ||
      (va.pattern || '') !== (vb.pattern || '') ||
      (va.gender || '') !== (vb.gender || '') ||
      (va.age_group || '') !== (vb.age_group || '') ||
      (va.condition || 'new') !== (vb.condition || 'new') ||
      (va.shipping_weight || '') !== (vb.shipping_weight || '') ||
      JSON.stringify(va.extraAttributes || {}) !== JSON.stringify(vb.extraAttributes || {})
    ) {
      return false;
    }
  }
  return true;
}

function buildProductItemFromGroup(
  productId: string,
  effectiveItemGroupId: string,
  rows: NormalizedCsvRow[],
  variants: WebsiteVariant[],
  now: string
): ProductItem {
  const primary = variants[0];
  const firstNonEmpty = (getter: (r: NormalizedCsvRow) => string | undefined): string => {
    for (const r of rows) {
      const val = getter(r);
      if (val && val.trim() !== '') return val.trim();
    }
    return '';
  };

  const title = firstNonEmpty((r) => r.variant.title);
  const description = firstNonEmpty((r) => r.variant.description);
  const link = firstNonEmpty((r) => r.variant.link);
  const imageLink = firstNonEmpty((r) => r.variant.image_link);
  const additionalImageLink = firstNonEmpty((r) => r.variant.additional_image_link);
  const googleProductCategory = firstNonEmpty((r) => r.google_product_category);
  const productType = firstNonEmpty((r) => r.product_type);
  const price = firstNonEmpty((r) => r.variant.price);
  const salePrice = firstNonEmpty((r) => r.variant.sale_price);
  const brand = firstNonEmpty((r) => r.variant.brand) || 'Science of Gifts';
  const gtin = firstNonEmpty((r) => r.variant.gtin);
  const mpn = firstNonEmpty((r) => r.variant.mpn);
  const color = firstNonEmpty((r) => r.variant.color);
  const size = firstNonEmpty((r) => r.variant.size);
  const sizeType = firstNonEmpty((r) => r.variant.size_type) as MerchantData['size_type'];
  const material = firstNonEmpty((r) => r.variant.material);
  const pattern = firstNonEmpty((r) => r.variant.pattern);
  const gender = (firstNonEmpty((r) => r.variant.gender) || '') as MerchantData['gender'];
  const ageGroup = (firstNonEmpty((r) => r.variant.age_group) || '') as MerchantData['age_group'];
  const condition = (primary.condition || 'new') as MerchantData['condition'];
  const availability = variants.some((v) => v.availability === 'in_stock')
    ? 'in_stock'
    : primary.availability || 'in_stock';
  const identifierExists: 'yes' | 'no' =
    primary.identifier_exists || (gtin || mpn ? 'yes' : 'no');

  const customLabel0 = firstNonEmpty((r) => r.custom_label_0);
  const customLabel1 = firstNonEmpty((r) => r.custom_label_1);
  const customLabel2 = firstNonEmpty((r) => r.custom_label_2);
  const customLabel3 = firstNonEmpty((r) => r.custom_label_3);
  const customLabel4 = firstNonEmpty((r) => r.custom_label_4);

  const merchantData: MerchantData = {
    id: productId,
    link,
    title,
    description,
    image_link: imageLink,
    additional_image_link: additionalImageLink,
    google_product_category: googleProductCategory,
    product_type: productType,
    price,
    sale_price: salePrice,
    availability,
    brand,
    gtin,
    mpn,
    identifier_exists: identifierExists,
    item_group_id: variants.length >= 2 ? effectiveItemGroupId : '',
    color,
    size,
    size_type: sizeType,
    material,
    pattern,
    gender,
    age_group: ageGroup,
    condition,
    custom_label_0: customLabel0,
    custom_label_1: customLabel1,
    custom_label_2: customLabel2,
    custom_label_3: customLabel3,
    custom_label_4: customLabel4,
  };

  const uniqueImages = Array.from(
    new Set(
      variants
        .flatMap((v) => [v.image_link, v.additional_image_link || ''])
        .filter((u) => Boolean(u && u.trim()))
    )
  );

  const evidence: EvidenceModel = {
    sourceUrl: link,
    extractedAt: now,
    pageTitle: title,
    rawDescription: description,
    verifiedAttributes: {
      brand: merchantData.brand,
      color: merchantData.color || undefined,
      size: merchantData.size || undefined,
      material: merchantData.material || undefined,
      gtin: merchantData.gtin || undefined,
      mpn: merchantData.mpn || undefined,
    },
    unresolvedAttributes: [],
    confidenceScores: {
      title: 1.0,
      price: price ? 1.0 : 0.0,
      imported_data: 0.9,
    },
    variants: variants.map((v) => ({
      id: v.id,
      title: [v.size, v.color].filter(Boolean).join(' / ') || v.title || v.id,
      price: v.price,
      sku: v.mpn,
      color: v.color,
      size: v.size,
      material: v.material,
      image: v.image_link,
      available: v.availability === 'in_stock',
    })),
    images: uniqueImages,
    userCorrections: {},
  };

  const giftIntelligence: GiftIntelligence = {
    theme: customLabel3 || '',
    subtheme: '',
    targetAudience: customLabel0 ? [customLabel0] : [],
    recipientPersonas: [],
    occasions: [],
    primaryGiftIntent: '',
    secondaryGiftIntents: [],
    searchConcepts: [],
  };

  const product: ProductItem = {
    id: productId,
    status: 'not_analyzed',
    evidence,
    merchantData,
    giftIntelligence,
    titleCandidates: [],
    originalImported: { ...merchantData },
    appliedSuggestions: [],
    syncedVariants: variants.map((v) => ({ ...v })),
    history: [
      {
        timestamp: now,
        note: `Initial import from CSV (${variants.length} variant${variants.length === 1 ? '' : 's'})`,
        snapshot: { ...merchantData },
      },
    ],
    validation: { isValid: true, blockingErrors: [], warnings: [] },
    createdAt: now,
    updatedAt: now,
  };

  const { status, validation } = computeProductStatus(product);
  product.status = status === 'optimized' ? 'needs_review' : status;
  product.validation = validation;

  return product;
}

/**
 * Deterministically groups parsed Google Merchant Center CSV rows into parent ProductItems
 * with complete variant data in `syncedVariants`, while preserving separate products whenever
 * identifiers conflict or grouping is ambiguous.
 */
export function groupCsvRowsToProducts(parsedRows: Array<Record<string, string>>): CsvGroupingResult {
  const now = new Date().toISOString();
  const normalizedRows = parsedRows.map((row, idx) => normalizeCsvRow(row, idx));
  const conflicts: CsvImportConflict[] = [];

  // Pre-scan identifier relationships to detect conflicts before grouping
  const urlsByGroupId = new Map<string, Set<string>>();
  const rowsByGroupId = new Map<string, NormalizedCsvRow[]>();
  const groupIdsByUrl = new Map<string, Set<string>>();
  const rowsWithoutGroupIdByUrl = new Map<string, NormalizedCsvRow[]>();

  for (const r of normalizedRows) {
    if (r.rawItemGroupId) {
      if (!rowsByGroupId.has(r.rawItemGroupId)) rowsByGroupId.set(r.rawItemGroupId, []);
      rowsByGroupId.get(r.rawItemGroupId)!.push(r);
      if (r.canonicalUrl) {
        if (!urlsByGroupId.has(r.rawItemGroupId)) urlsByGroupId.set(r.rawItemGroupId, new Set());
        urlsByGroupId.get(r.rawItemGroupId)!.add(r.canonicalUrl);

        if (!groupIdsByUrl.has(r.canonicalUrl)) groupIdsByUrl.set(r.canonicalUrl, new Set());
        groupIdsByUrl.get(r.canonicalUrl)!.add(r.rawItemGroupId);
      }
    } else if (r.canonicalUrl) {
      if (!rowsWithoutGroupIdByUrl.has(r.canonicalUrl)) rowsWithoutGroupIdByUrl.set(r.canonicalUrl, []);
      rowsWithoutGroupIdByUrl.get(r.canonicalUrl)!.push(r);
    }
  }

  // Flag intra-CSV item_group_id <-> URL conflicts
  const conflictingGroupIds = new Set<string>();
  for (const [gid, urlSet] of urlsByGroupId.entries()) {
    if (urlSet.size > 1) {
      conflictingGroupIds.add(gid);
      const affected = rowsByGroupId.get(gid) || [];
      conflicts.push({
        type: 'item_group_id_url_conflict',
        identifier: gid,
        message: `item_group_id "${gid}" appears across ${urlSet.size} different product URLs (${Array.from(urlSet).join(', ')}).`,
        resolution: 'Preserved as separate products per canonical URL to avoid merging distinct designs.',
        affectedRowIndexes: affected.map((r) => r.rowIndex),
      });
    }
  }

  const conflictingUrls = new Set<string>();
  for (const [url, gidSet] of groupIdsByUrl.entries()) {
    if (gidSet.size > 1) {
      conflictingUrls.add(url);
      conflicts.push({
        type: 'url_item_group_id_conflict',
        identifier: url,
        message: `Canonical URL "${url}" is associated with ${gidSet.size} different item_group_id values (${Array.from(gidSet).join(', ')}).`,
        resolution: 'Preserved as separate products per item_group_id.',
      });
    }
  }

  // Determine which URL-only rows can safely group vs must stay separate due to conflict/ambiguity
  const ambiguousUrls = new Set<string>();
  for (const [url, noGidRows] of rowsWithoutGroupIdByUrl.entries()) {
    if (groupIdsByUrl.has(url)) {
      ambiguousUrls.add(url);
      conflicts.push({
        type: 'mixed_group_id_on_url',
        identifier: url,
        message: `Canonical URL "${url}" has rows with an item_group_id and ${noGidRows.length} row(s) without an item_group_id.`,
        resolution: 'Preserved rows without item_group_id as separate standalone products.',
        affectedRowIndexes: noGidRows.map((r) => r.rowIndex),
      });
      continue;
    }

    if (noGidRows.length > 1) {
      if (!isSpecificProductUrl(url)) {
        ambiguousUrls.add(url);
        conflicts.push({
          type: 'ambiguous_url_grouping',
          identifier: url,
          message: `Generic URL "${url}" is shared by ${noGidRows.length} rows without item_group_id.`,
          resolution: 'Preserved each row as a separate product because the URL is not product-specific.',
          affectedRowIndexes: noGidRows.map((r) => r.rowIndex),
        });
        continue;
      }

      const distinctBaseTitles = new Set(
        noGidRows.map((r) => extractBaseTitleForGrouping(r.variant.title)).filter(Boolean)
      );
      const hasVariantAttributes = noGidRows.some((r) =>
        Boolean(r.variant.size || r.variant.color || r.variant.material || r.variant.pattern || r.variant.size_type)
      );
      const distinctVariantIds = new Set(noGidRows.map((r) => r.variant.id));

      // If titles disagree AND there are no distinguishing variant attributes (and they aren't duplicate rows of same ID),
      // treat grouping as ambiguous and preserve separately.
      if (distinctBaseTitles.size > 1 && !hasVariantAttributes && distinctVariantIds.size > 1) {
        ambiguousUrls.add(url);
        conflicts.push({
          type: 'ambiguous_url_grouping',
          identifier: url,
          message: `URL "${url}" has ${noGidRows.length} rows with different titles and no item_group_id or variant attributes.`,
          resolution: 'Preserved as separate products because variant grouping is ambiguous.',
          affectedRowIndexes: noGidRows.map((r) => r.rowIndex),
        });
      }
    }
  }

  // Build raw buckets keyed deterministically
  interface RawBucket {
    groupKey: string;
    rawItemGroupId: string;
    canonicalUrl: string;
    hasConflictingGroupId: boolean;
    hasConflictingUrl: boolean;
    rows: NormalizedCsvRow[];
    variants: WebsiteVariant[];
  }

  const buckets = new Map<string, RawBucket>();
  const variantIdToBucketKey = new Map<string, string>();
  let duplicateVariantRowsDeduplicated = 0;

  for (const row of normalizedRows) {
    let groupKey: string;
    let hasConflictingGroupId = false;
    let hasConflictingUrl = false;

    if (row.rawItemGroupId) {
      if (conflictingGroupIds.has(row.rawItemGroupId)) {
        hasConflictingGroupId = true;
        groupKey = `gid_split:${row.rawItemGroupId}|url:${row.canonicalUrl || row.variant.id}`;
      } else {
        groupKey = `gid:${row.rawItemGroupId}`;
      }
      if (row.canonicalUrl && conflictingUrls.has(row.canonicalUrl)) {
        hasConflictingUrl = true;
      }
    } else if (row.canonicalUrl && isSpecificProductUrl(row.canonicalUrl) && !ambiguousUrls.has(row.canonicalUrl)) {
      groupKey = `url:${row.canonicalUrl}`;
    } else {
      groupKey = `id:${row.variant.id}`;
      if (row.canonicalUrl && ambiguousUrls.has(row.canonicalUrl)) {
        hasConflictingUrl = true;
      }
    }

    // Check cross-group duplicate variant ID conflict
    const existingOwnerKey = variantIdToBucketKey.get(row.variant.id);
    if (existingOwnerKey && existingOwnerKey !== groupKey) {
      conflicts.push({
        type: 'duplicate_variant_id_across_groups',
        identifier: row.variant.id,
        message: `Variant ID "${row.variant.id}" (row ${row.rowIndex}) also appears in another product group (${existingOwnerKey}).`,
        resolution: 'Kept the variant in its first product group to prevent duplicate variant IDs across the catalog.',
        affectedRowIndexes: [row.rowIndex],
      });
      duplicateVariantRowsDeduplicated++;
      continue;
    }

    let bucket = buckets.get(groupKey);
    if (!bucket) {
      bucket = {
        groupKey,
        rawItemGroupId: row.rawItemGroupId,
        canonicalUrl: row.canonicalUrl,
        hasConflictingGroupId,
        hasConflictingUrl,
        rows: [],
        variants: [],
      };
      buckets.set(groupKey, bucket);
    }

    bucket.rows.push(row);
    if (!bucket.canonicalUrl && row.canonicalUrl) {
      bucket.canonicalUrl = row.canonicalUrl;
    }

    const existingVariantIdx = bucket.variants.findIndex((v) => v.id === row.variant.id);
    if (existingVariantIdx >= 0) {
      bucket.variants[existingVariantIdx] = mergeVariantNonBlank(
        bucket.variants[existingVariantIdx],
        row.variant,
        false
      );
      duplicateVariantRowsDeduplicated++;
    } else {
      bucket.variants.push({ ...row.variant });
      variantIdToBucketKey.set(row.variant.id, groupKey);
    }
  }

  // Convert buckets into CsvProductGroup & ProductItem objects
  const usedProductIds = new Set<string>();
  const groups: CsvProductGroup[] = [];
  let totalVariants = 0;

  for (const bucket of buckets.values()) {
    if (bucket.variants.length === 0) continue;
    const primaryVariantId = bucket.variants[0].id;
    const isMultiVariant = bucket.variants.length >= 2;

    // Derive effective item_group_id for multi-variant groups
    let effectiveItemGroupId = '';
    if (isMultiVariant) {
      if (bucket.rawItemGroupId && !bucket.hasConflictingGroupId) {
        effectiveItemGroupId = bucket.rawItemGroupId;
      } else if (bucket.rawItemGroupId && bucket.hasConflictingGroupId) {
        // Distinct deterministic group ID for a split conflicting group so export doesn't re-collide
        effectiveItemGroupId = `${bucket.rawItemGroupId}_${fnv1aHash(bucket.canonicalUrl || primaryVariantId)}`;
      } else {
        const slugPart = bucket.canonicalUrl.split('/products/')[1];
        const cleanSlug = slugPart ? slugPart.replace(/[^a-z0-9-_]/gi, '-').toLowerCase() : '';
        effectiveItemGroupId = cleanSlug ? `grp_${cleanSlug}` : `grp_${primaryVariantId}`;
      }
    }

    // Normalize item_group_id on each variant inside this group
    const finalizedVariants: WebsiteVariant[] = bucket.variants.map((v) => ({
      ...v,
      item_group_id: isMultiVariant ? effectiveItemGroupId : '',
    }));

    // Stable product ID: never invent random/timestamp IDs when stable IDs exist
    let proposedProductId =
      isMultiVariant && bucket.rawItemGroupId && !bucket.hasConflictingGroupId
        ? bucket.rawItemGroupId
        : primaryVariantId;

    if (usedProductIds.has(proposedProductId)) {
      proposedProductId = `${proposedProductId}_${fnv1aHash(bucket.groupKey)}`;
    }
    usedProductIds.add(proposedProductId);

    const product = buildProductItemFromGroup(
      proposedProductId,
      effectiveItemGroupId,
      bucket.rows,
      finalizedVariants,
      now
    );

    groups.push({
      groupKey: bucket.groupKey,
      proposedProductId,
      rawItemGroupId: bucket.rawItemGroupId,
      effectiveItemGroupId,
      primaryVariantId,
      canonicalUrl: bucket.canonicalUrl,
      hasConflictingGroupId: bucket.hasConflictingGroupId,
      hasConflictingUrl: bucket.hasConflictingUrl,
      rows: bucket.rows,
      variants: finalizedVariants,
      product,
    });

    totalVariants += finalizedVariants.length;
  }

  return {
    totalCsvRows: normalizedRows.length,
    totalVariants,
    duplicateVariantRowsDeduplicated,
    groups,
    products: groups.map((g) => g.product),
    conflicts,
  };
}

/**
 * Converts parsed Merchant Center CSV rows into grouped product-level ProductItem records,
 * each containing its complete variant list in `syncedVariants`.
 */
export function convertParsedCsvToProducts(parsedRows: Array<Record<string, string>>): ProductItem[] {
  return groupCsvRowsToProducts(parsedRows).products;
}

function getCatalogItemCanonicalUrl(item: ProductItem): string {
  return normalizeCanonicalProductUrl(
    item.merchantData.link || item.evidence?.sourceUrl || item.websiteSyncMeta?.canonicalProductUrl
  );
}

function getCatalogItemGroupIds(item: ProductItem): Set<string> {
  const gids = new Set<string>();
  const mdGid = normalizeItemGroupId(item.merchantData.item_group_id);
  if (mdGid) gids.add(mdGid);
  const metaGid = normalizeItemGroupId(item.websiteSyncMeta?.websiteItemGroupId);
  if (metaGid) gids.add(metaGid);
  for (const v of item.syncedVariants || []) {
    const vg = normalizeItemGroupId(v.item_group_id);
    if (vg) gids.add(vg);
  }
  return gids;
}

function getCatalogItemVariantIds(item: ProductItem): Set<string> {
  const ids = new Set<string>();
  if (item.websiteSyncMeta?.websitePrimaryVariantId) {
    ids.add(item.websiteSyncMeta.websitePrimaryVariantId.trim());
  }
  for (const v of item.syncedVariants || []) {
    if (v.id && v.id.trim()) ids.add(v.id.trim());
  }
  return ids;
}

function isMerchantDataEqual(a: MerchantData, b: MerchantData): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof MerchantData>;
  for (const key of keys) {
    if ((a[key] ?? '') !== (b[key] ?? '')) {
      return false;
    }
  }
  return true;
}

function mergeCsvGroupIntoExistingProduct(
  existing: ProductItem,
  group: CsvProductGroup,
  mode: 'merge' | 'update',
  matchMethod: CsvImportMatchMethod,
  now: string
): {
  product: ProductItem;
  modified: boolean;
  variantsAdded: number;
  preservedCustomFields: string[];
} {
  const overwriteFactual = mode === 'update';
  const userCorrections = existing.evidence?.userCorrections || {};
  const prov = existing.fieldProvenance || {};
  const preservedCustomFields: string[] = [];

  const isUserEdited = (field: string): boolean =>
    Boolean(userCorrections[field]) || prov[field] === 'USER_EDITED';

  // Merge syncedVariants by stable variant ID without duplicates or blank overwrites
  const existingVariants = (existing.syncedVariants || []).map((v) => ({ ...v }));
  const mergedVariants: WebsiteVariant[] = [...existingVariants];
  let variantsAdded = 0;

  for (const incomingVar of group.variants) {
    const idx = mergedVariants.findIndex((v) => v.id === incomingVar.id);
    if (idx >= 0) {
      mergedVariants[idx] = mergeVariantNonBlank(mergedVariants[idx], incomingVar, overwriteFactual);
    } else {
      mergedVariants.push({ ...incomingVar });
      variantsAdded++;
    }
  }

  // Ensure consistent item_group_id across merged variants
  const existingGroupId =
    normalizeItemGroupId(existing.merchantData.item_group_id) ||
    normalizeItemGroupId(existing.websiteSyncMeta?.websiteItemGroupId);
  const sharedGroupId =
    mergedVariants.length >= 2
      ? existingGroupId || group.effectiveItemGroupId || existing.id
      : '';

  const normalizedMergedVariants: WebsiteVariant[] = mergedVariants.map((v) => ({
    ...v,
    item_group_id: mergedVariants.length >= 2 ? sharedGroupId : '',
  }));

  const incomingMd = group.product.merchantData;
  const curMd = existing.merchantData;

  const pickProtectedCustom = (
    field:
      | 'title'
      | 'description'
      | 'google_product_category'
      | 'product_type'
      | 'custom_label_0'
      | 'custom_label_1'
      | 'custom_label_2'
      | 'custom_label_3'
      | 'custom_label_4'
  ): string => {
    const curVal = (curMd[field] || '').trim();
    const incVal = (incomingMd[field] || '').trim();
    if (curVal) {
      if (incVal && incVal !== curVal) {
        preservedCustomFields.push(field);
      }
      return curMd[field];
    }
    return incVal;
  };

  const pickFactual = <K extends keyof MerchantData>(field: K): MerchantData[K] => {
    const curVal = curMd[field];
    const incVal = incomingMd[field];
    const curFilled = curVal !== undefined && curVal !== null && String(curVal).trim() !== '';
    const incFilled = incVal !== undefined && incVal !== null && String(incVal).trim() !== '';

    if (isUserEdited(String(field)) && curFilled) {
      if (incFilled && curVal !== incVal) {
        preservedCustomFields.push(String(field));
      }
      return curVal;
    }

    if (overwriteFactual) {
      // Never overwrite populated fields with blanks
      return incFilled ? incVal : curVal;
    }

    // Merge mode (default): preserve populated existing values, only fill blanks
    return curFilled ? curVal : incVal;
  };

  const nextItemGroupId =
    normalizedMergedVariants.length >= 2
      ? sharedGroupId
      : curMd.item_group_id || '';

  const nextMerchantData: MerchantData = {
    ...curMd,
    id: existing.id, // Strictly preserve existing product ID
    title: pickProtectedCustom('title'),
    description: pickProtectedCustom('description'),
    google_product_category: pickProtectedCustom('google_product_category'),
    product_type: pickProtectedCustom('product_type'),
    custom_label_0: pickProtectedCustom('custom_label_0'),
    custom_label_1: pickProtectedCustom('custom_label_1'),
    custom_label_2: pickProtectedCustom('custom_label_2'),
    custom_label_3: pickProtectedCustom('custom_label_3'),
    custom_label_4: pickProtectedCustom('custom_label_4'),
    link: pickFactual('link'),
    image_link: pickFactual('image_link'),
    additional_image_link: pickFactual('additional_image_link'),
    price: pickFactual('price'),
    sale_price: pickFactual('sale_price'),
    availability: pickFactual('availability'),
    brand: pickFactual('brand'),
    gtin: pickFactual('gtin'),
    mpn: pickFactual('mpn'),
    identifier_exists: pickFactual('identifier_exists'),
    item_group_id: nextItemGroupId,
    color: pickFactual('color'),
    size: pickFactual('size'),
    size_type: pickFactual('size_type'),
    material: pickFactual('material'),
    pattern: pickFactual('pattern'),
    gender: pickFactual('gender'),
    age_group: pickFactual('age_group'),
    condition: pickFactual('condition'),
  };

  const variantsChanged = !areSyncedVariantsEqual(existing.syncedVariants, normalizedMergedVariants);
  const merchantChanged = !isMerchantDataEqual(curMd, nextMerchantData);

  if (!variantsChanged && !merchantChanged) {
    return {
      product: existing,
      modified: false,
      variantsAdded: 0,
      preservedCustomFields,
    };
  }

  const nextEvidenceImages = Array.from(
    new Set([
      ...(existing.evidence?.images || []),
      ...normalizedMergedVariants.flatMap((v) => [v.image_link, v.additional_image_link || '']),
    ].filter((u) => Boolean(u && u.trim())))
  );

  const nextEvidenceVariants = normalizedMergedVariants.map((v) => ({
    id: v.id,
    title: [v.size, v.color].filter(Boolean).join(' / ') || v.title || v.id,
    price: v.price,
    sku: v.mpn,
    color: v.color,
    size: v.size,
    material: v.material,
    image: v.image_link,
    available: v.availability === 'in_stock',
  }));

  const updatedProduct: ProductItem = {
    ...existing,
    id: existing.id, // Strictly preserve existing ID
    merchantData: nextMerchantData,
    syncedVariants: normalizedMergedVariants,
    evidence: {
      ...existing.evidence,
      variants: nextEvidenceVariants,
      images: nextEvidenceImages,
      userCorrections: { ...userCorrections },
    },
    websiteSyncMeta: existing.websiteSyncMeta
      ? {
          ...existing.websiteSyncMeta,
          variantCount: normalizedMergedVariants.length,
          websiteItemGroupId:
            existing.websiteSyncMeta.websiteItemGroupId || sharedGroupId || undefined,
        }
      : undefined,
    originalImported: existing.originalImported || { ...curMd },
    history: [
      {
        timestamp: now,
        note: `CSV ${mode} (${matchMethod}): ${normalizedMergedVariants.length} total variant(s)${
          variantsAdded > 0 ? `, +${variantsAdded} new` : ''
        } — preserved custom edits & optimization metadata`,
        snapshot: { ...curMd },
      },
      ...(existing.history || []),
    ],
    updatedAt: now,
  };

  return {
    product: updatedProduct,
    modified: true,
    variantsAdded,
    preservedCustomFields,
  };
}

interface CsvReconciliationResult {
  updatedCatalog: ProductItem[];
  preview: CsvImportPreview;
  summary: CsvImportApplySummary;
}

function reconcileCsvCatalogImport(
  existingCatalog: readonly ProductItem[],
  csvText: string,
  mode: CsvImportMode = 'merge'
): CsvReconciliationResult {
  const now = new Date().toISOString();
  const parsedRows = parseCsvText(csvText);
  const grouped = groupCsvRowsToProducts(parsedRows);
  const conflicts: CsvImportConflict[] = [...grouped.conflicts];

  if (mode === 'replace') {
    const newProductsPreview: CsvImportNewProductPreview[] = grouped.groups.map((g) => ({
      proposedId: g.proposedProductId,
      title: g.product.merchantData.title,
      link: g.product.merchantData.link,
      itemGroupId: g.effectiveItemGroupId,
      variantCount: g.variants.length,
      sizes: Array.from(new Set(g.variants.map((v) => v.size || '').filter(Boolean))),
      colors: Array.from(new Set(g.variants.map((v) => v.color || '').filter(Boolean))),
    }));

    const finalizedCatalog = grouped.products.map((item) => {
      const { status, validation } = computeProductStatus(item, grouped.products);
      return {
        ...item,
        status: item.status === 'not_analyzed' && validation.isValid ? 'not_analyzed' : status,
        validation,
      };
    });

    const resultingVariantCount = finalizedCatalog.reduce(
      (acc, p) => acc + (p.syncedVariants && p.syncedVariants.length > 0 ? p.syncedVariants.length : 1),
      0
    );

    const preview: CsvImportPreview = {
      mode,
      totalCsvRows: grouped.totalCsvRows,
      uniqueProducts: grouped.groups.length,
      totalVariants: grouped.totalVariants,
      duplicateVariantRowsDeduplicated: grouped.duplicateVariantRowsDeduplicated,
      newProductsCount: grouped.groups.length,
      matchedExistingCount: 0,
      conflictsCount: conflicts.length,
      existingCatalogCount: existingCatalog.length,
      unmatchedExistingCount: existingCatalog.length,
      resultingProductCount: finalizedCatalog.length,
      resultingVariantCount,
      requiresConfirmation: true,
      newProducts: newProductsPreview,
      matchedProducts: [],
      conflicts,
    };

    const summary: CsvImportApplySummary = {
      mode,
      totalCsvRows: grouped.totalCsvRows,
      uniqueCsvProducts: grouped.groups.length,
      totalCsvVariants: grouped.totalVariants,
      duplicateVariantRowsDeduplicated: grouped.duplicateVariantRowsDeduplicated,
      newProductsAdded: finalizedCatalog.length,
      matchedProductsCount: 0,
      matchedProductsModified: 0,
      matchedProductsUnchanged: 0,
      variantsAdded: grouped.totalVariants,
      conflictsCount: conflicts.length,
      catalogCountBefore: existingCatalog.length,
      catalogCountAfter: finalizedCatalog.length,
      totalCatalogVariantsAfter: resultingVariantCount,
      conflicts,
    };

    return { updatedCatalog: finalizedCatalog, preview, summary };
  }

  // Merge or Update mode: preserve existing catalog records and reconcile deterministically
  const workingCatalog: ProductItem[] = existingCatalog.map((item) => item);
  const matchedCatalogIds = new Set<string>();
  const matchedPreviews: CsvImportMatchedPreview[] = [];
  const newProductsPreview: CsvImportNewProductPreview[] = [];
  const touchedIds = new Set<string>();

  let matchedModifiedCount = 0;
  let matchedUnchangedCount = 0;
  let totalVariantsAdded = 0;

  for (const group of grouped.groups) {
    const groupVariantIdSet = new Set(group.variants.map((v) => v.id));

    let matchedItemIndex = -1;
    let matchMethod: CsvImportMatchMethod | null = null;
    let skipDueToConflict = false;

    // 1. Strongest deterministic match: Exact Product ID or existing Variant ID
    const idCandidates = workingCatalog
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => {
        if (matchedCatalogIds.has(item.id)) return false;
        if (item.id === group.proposedProductId || item.merchantData.id === group.proposedProductId) {
          return true;
        }
        if (groupVariantIdSet.has(item.id) || groupVariantIdSet.has(item.merchantData.id)) {
          return true;
        }
        const existingVarIds = getCatalogItemVariantIds(item);
        for (const vid of groupVariantIdSet) {
          if (existingVarIds.has(vid)) return true;
        }
        return false;
      });

    if (idCandidates.length === 1) {
      const candidate = idCandidates[0];
      const existingUrl = getCatalogItemCanonicalUrl(candidate.item);
      const existingGids = getCatalogItemGroupIds(candidate.item);
      const hasUrlConflict = Boolean(existingUrl && group.canonicalUrl && existingUrl !== group.canonicalUrl);
      const hasGidConflict = Boolean(
        group.rawItemGroupId &&
          existingGids.size > 0 &&
          !existingGids.has(group.rawItemGroupId) &&
          !existingGids.has(group.effectiveItemGroupId)
      );

      if (hasUrlConflict && (hasGidConflict || candidate.item.id !== group.proposedProductId)) {
        conflicts.push({
          type: 'catalog_variant_id_conflict',
          identifier: group.proposedProductId,
          message: `CSV group "${group.proposedProductId}" shares an ID with existing catalog product "${candidate.item.id}", but canonical URLs conflict ("${group.canonicalUrl}" vs "${existingUrl}").`,
          resolution: 'Preserved existing product untouched and imported CSV group separately.',
          affectedProductIds: [candidate.item.id],
        });
        skipDueToConflict = true;
      } else {
        matchedItemIndex = candidate.idx;
        matchMethod =
          candidate.item.id === group.proposedProductId ||
          candidate.item.merchantData.id === group.proposedProductId
            ? 'id'
            : 'variant_id';
      }
    } else if (idCandidates.length > 1) {
      conflicts.push({
        type: 'ambiguous_catalog_match',
        identifier: group.proposedProductId,
        message: `CSV group "${group.proposedProductId}" matched ${idCandidates.length} existing catalog products by ID/variant ID.`,
        resolution: 'Preserved existing catalog products untouched and kept CSV group separate.',
        affectedProductIds: idCandidates.map((c) => c.item.id),
      });
      skipDueToConflict = true;
    }

    // 2. Match by valid, non-conflicting item_group_id
    if (
      matchedItemIndex === -1 &&
      !skipDueToConflict &&
      group.rawItemGroupId &&
      !group.hasConflictingGroupId
    ) {
      const gidCandidates = workingCatalog
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => {
          if (matchedCatalogIds.has(item.id)) return false;
          const existingGids = getCatalogItemGroupIds(item);
          return existingGids.has(group.rawItemGroupId);
        });

      if (gidCandidates.length === 1) {
        const candidate = gidCandidates[0];
        const existingUrl = getCatalogItemCanonicalUrl(candidate.item);
        if (existingUrl && group.canonicalUrl && existingUrl !== group.canonicalUrl) {
          conflicts.push({
            type: 'catalog_item_group_id_url_conflict',
            identifier: group.rawItemGroupId,
            message: `CSV item_group_id "${group.rawItemGroupId}" matched catalog product "${candidate.item.id}", but URLs differ ("${group.canonicalUrl}" vs "${existingUrl}").`,
            resolution: 'Preserved as separate product to prevent merging distinct items.',
            affectedProductIds: [candidate.item.id],
          });
          skipDueToConflict = true;
        } else {
          matchedItemIndex = candidate.idx;
          matchMethod = 'item_group_id';
        }
      } else if (gidCandidates.length > 1) {
        conflicts.push({
          type: 'ambiguous_catalog_match',
          identifier: group.rawItemGroupId,
          message: `item_group_id "${group.rawItemGroupId}" matched ${gidCandidates.length} existing catalog products.`,
          resolution: 'Preserved existing products untouched and kept CSV group separate.',
          affectedProductIds: gidCandidates.map((c) => c.item.id),
        });
        skipDueToConflict = true;
      }
    }

    // 3. Match by normalized canonical product URL (only when product-specific & unambiguous)
    if (
      matchedItemIndex === -1 &&
      !skipDueToConflict &&
      isSpecificProductUrl(group.canonicalUrl) &&
      !group.hasConflictingUrl
    ) {
      const urlCandidates = workingCatalog
        .map((item, idx) => ({ item, idx }))
        .filter(({ item }) => {
          if (matchedCatalogIds.has(item.id)) return false;
          return getCatalogItemCanonicalUrl(item) === group.canonicalUrl;
        });

      if (urlCandidates.length === 1) {
        const candidate = urlCandidates[0];
        const existingGids = getCatalogItemGroupIds(candidate.item);
        if (
          group.rawItemGroupId &&
          existingGids.size > 0 &&
          !existingGids.has(group.rawItemGroupId) &&
          !existingGids.has(group.effectiveItemGroupId)
        ) {
          conflicts.push({
            type: 'catalog_url_item_group_id_conflict',
            identifier: group.canonicalUrl,
            message: `CSV canonical URL "${group.canonicalUrl}" matched catalog product "${candidate.item.id}", but item_group_id conflicts ("${group.rawItemGroupId}" vs "${Array.from(existingGids).join(', ')}").`,
            resolution: 'Preserved as separate product because item_group_id values conflict.',
            affectedProductIds: [candidate.item.id],
          });
          skipDueToConflict = true;
        } else {
          matchedItemIndex = candidate.idx;
          matchMethod = 'canonical_url';
        }
      } else if (urlCandidates.length > 1) {
        conflicts.push({
          type: 'ambiguous_catalog_match',
          identifier: group.canonicalUrl,
          message: `Canonical URL "${group.canonicalUrl}" matched ${urlCandidates.length} existing catalog products.`,
          resolution: 'Preserved existing catalog products untouched and kept CSV group separate.',
          affectedProductIds: urlCandidates.map((c) => c.item.id),
        });
        skipDueToConflict = true;
      }
    }

    if (matchedItemIndex >= 0 && matchMethod) {
      const existingItem = workingCatalog[matchedItemIndex];
      matchedCatalogIds.add(existingItem.id);

      const merged = mergeCsvGroupIntoExistingProduct(existingItem, group, mode, matchMethod, now);
      workingCatalog[matchedItemIndex] = merged.product;

      if (merged.modified) {
        matchedModifiedCount++;
        touchedIds.add(merged.product.id);
      } else {
        matchedUnchangedCount++;
      }
      totalVariantsAdded += merged.variantsAdded;

      matchedPreviews.push({
        catalogProductId: existingItem.id,
        catalogTitle: existingItem.merchantData.title,
        csvTitle: group.product.merchantData.title,
        matchMethod,
        existingVariantCount: existingItem.syncedVariants?.length || 0,
        incomingVariantCount: group.variants.length,
        resultingVariantCount: merged.product.syncedVariants?.length || group.variants.length,
        preservedCustomFields: merged.preservedCustomFields,
        willModify: merged.modified,
      });
    } else {
      // New product (or conflict preserved as separate product)
      let newProduct = group.product;
      const existingIdTaken = workingCatalog.some((p) => p.id === newProduct.id);
      if (existingIdTaken) {
        // Deterministic disambiguation so repeated imports of the same conflicting CSV remain idempotent
        const disambiguatedId = `${newProduct.id}_${fnv1aHash(group.canonicalUrl || group.groupKey)}`;
        // Check if this exact disambiguated product was already created on a previous import!
        const priorDisambiguatedIdx = workingCatalog.findIndex((p) => p.id === disambiguatedId);
        if (priorDisambiguatedIdx >= 0 && !matchedCatalogIds.has(disambiguatedId)) {
          const priorItem = workingCatalog[priorDisambiguatedIdx];
          matchedCatalogIds.add(priorItem.id);
          const merged = mergeCsvGroupIntoExistingProduct(priorItem, group, mode, 'id', now);
          workingCatalog[priorDisambiguatedIdx] = merged.product;
          if (merged.modified) {
            matchedModifiedCount++;
            touchedIds.add(merged.product.id);
          } else {
            matchedUnchangedCount++;
          }
          totalVariantsAdded += merged.variantsAdded;
          matchedPreviews.push({
            catalogProductId: priorItem.id,
            catalogTitle: priorItem.merchantData.title,
            csvTitle: group.product.merchantData.title,
            matchMethod: 'id',
            existingVariantCount: priorItem.syncedVariants?.length || 0,
            incomingVariantCount: group.variants.length,
            resultingVariantCount: merged.product.syncedVariants?.length || group.variants.length,
            preservedCustomFields: merged.preservedCustomFields,
            willModify: merged.modified,
          });
          continue;
        }

        newProduct = {
          ...newProduct,
          id: disambiguatedId,
          merchantData: {
            ...newProduct.merchantData,
            id: disambiguatedId,
          },
          originalImported: newProduct.originalImported
            ? { ...newProduct.originalImported, id: disambiguatedId }
            : undefined,
        };
      }

      workingCatalog.push(newProduct);
      matchedCatalogIds.add(newProduct.id);
      touchedIds.add(newProduct.id);
      totalVariantsAdded += newProduct.syncedVariants?.length || 1;

      newProductsPreview.push({
        proposedId: newProduct.id,
        title: newProduct.merchantData.title,
        link: newProduct.merchantData.link,
        itemGroupId: newProduct.merchantData.item_group_id || '',
        variantCount: newProduct.syncedVariants?.length || 1,
        sizes: Array.from(new Set((newProduct.syncedVariants || []).map((v) => v.size || '').filter(Boolean))),
        colors: Array.from(new Set((newProduct.syncedVariants || []).map((v) => v.color || '').filter(Boolean))),
      });
    }
  }

  // Recompute validation & status only on touched items so untouched records stay identical
  const finalizedCatalog = workingCatalog.map((item) => {
    if (!touchedIds.has(item.id)) return item;
    const { status, validation } = computeProductStatus(item, workingCatalog);
    return {
      ...item,
      status: item.status === 'not_analyzed' && validation.isValid ? 'not_analyzed' : status,
      validation,
    };
  });

  const resultingVariantCount = finalizedCatalog.reduce(
    (acc, p) => acc + (p.syncedVariants && p.syncedVariants.length > 0 ? p.syncedVariants.length : 1),
    0
  );

  const preview: CsvImportPreview = {
    mode,
    totalCsvRows: grouped.totalCsvRows,
    uniqueProducts: grouped.groups.length,
    totalVariants: grouped.totalVariants,
    duplicateVariantRowsDeduplicated: grouped.duplicateVariantRowsDeduplicated,
    newProductsCount: newProductsPreview.length,
    matchedExistingCount: matchedPreviews.length,
    conflictsCount: conflicts.length,
    existingCatalogCount: existingCatalog.length,
    unmatchedExistingCount: existingCatalog.length - matchedPreviews.length,
    resultingProductCount: finalizedCatalog.length,
    resultingVariantCount,
    requiresConfirmation: mode !== 'merge',
    newProducts: newProductsPreview,
    matchedProducts: matchedPreviews,
    conflicts,
  };

  const summary: CsvImportApplySummary = {
    mode,
    totalCsvRows: grouped.totalCsvRows,
    uniqueCsvProducts: grouped.groups.length,
    totalCsvVariants: grouped.totalVariants,
    duplicateVariantRowsDeduplicated: grouped.duplicateVariantRowsDeduplicated,
    newProductsAdded: newProductsPreview.length,
    matchedProductsCount: matchedPreviews.length,
    matchedProductsModified: matchedModifiedCount,
    matchedProductsUnchanged: matchedUnchangedCount,
    variantsAdded: totalVariantsAdded,
    conflictsCount: conflicts.length,
    catalogCountBefore: existingCatalog.length,
    catalogCountAfter: finalizedCatalog.length,
    totalCatalogVariantsAfter: resultingVariantCount,
    conflicts,
  };

  return { updatedCatalog: finalizedCatalog, preview, summary };
}

/**
 * Generates a strictly read-only import preview showing total CSV rows, unique products,
 * variants, new products, matched existing products, and conflicts without mutating the catalog.
 */
export function previewCsvCatalogImport(
  existingCatalog: readonly ProductItem[],
  csvText: string,
  mode: CsvImportMode = 'merge'
): CsvImportPreview {
  return reconcileCsvCatalogImport(existingCatalog, csvText, mode).preview;
}

/**
 * Applies a Merchant Center CSV import to a catalog using deterministic grouping, matching,
 * deduplication, and non-destructive field preservation (zero AI calls).
 */
export function applyCsvCatalogImport(
  existingCatalog: readonly ProductItem[],
  csvText: string,
  mode: CsvImportMode = 'merge'
): { updatedCatalog: ProductItem[]; preview: CsvImportPreview; summary: CsvImportApplySummary } {
  return reconcileCsvCatalogImport(existingCatalog, csvText, mode);
}


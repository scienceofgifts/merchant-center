import { MerchantData, ProductItem, EvidenceModel, GiftIntelligence, DeterministicValidation } from '../types/feed';
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

export function generateMerchantCenterCsv(items: ProductItem[]): string {
  const headers = [...MERCHANT_CENTER_COLUMNS];
  const rows: string[] = [];

  rows.push(headers.join(','));

  for (const item of items) {
    const d = item.merchantData;
    const rowValues = headers.map((col) => {
      const val = (d as any)[col] ?? '';
      return escapeCsvField(val);
    });
    rows.push(rowValues.join(','));
  }

  return rows.join('\r\n');
}

export function parseCsvText(csvText: string): Array<Record<string, string>> {
  const cleanText = csvText.trim();
  if (!cleanText) return [];

  const delimiter = cleanText.includes('\t') && !cleanText.includes(',') ? '\t' : ',';
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

  const headerRow = lines[0].map((h) => h.toLowerCase().trim().replace(/[\s-]+/g, '_'));
  const results: Array<Record<string, string>> = [];

  for (let r = 1; r < lines.length; r++) {
    const row = lines[r];
    if (row.length === 0 || (row.length === 1 && row[0] === '')) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headerRow.length; c++) {
      const headerKey = headerRow[c];
      obj[headerKey] = row[c] !== undefined ? row[c] : '';
    }
    results.push(obj);
  }

  return results;
}

export function convertParsedCsvToProducts(parsedRows: Array<Record<string, string>>): ProductItem[] {
  const now = new Date().toISOString();

  return parsedRows.map((row, index) => {
    const id = row.id || row.item_id || row.sku || `import_${Date.now()}_${index + 1}`;
    const link = row.link || row.url || row.product_url || '';
    const title = row.title || row.product_title || row.name || '';
    const description = row.description || row.desc || '';
    const imageLink = row.image_link || row.image || row.image_url || '';
    const additionalImageLink = row.additional_image_link || '';
    const price = row.price || '$0.00';
    const salePrice = row.sale_price || '';
    const availability = (row.availability?.toLowerCase() as any) || 'in_stock';
    const brand = row.brand || 'Science of Gifts';
    const gtin = row.gtin || '';
    const mpn = row.mpn || '';
    const identifierExists = (row.identifier_exists?.toLowerCase() as any) || (gtin || mpn ? 'yes' : 'no');
    const googleProductCategory = row.google_product_category || row.category || '';
    const productType = row.product_type || '';
    const itemGroupId = row.item_group_id || '';
    const color = row.color || '';
    const size = row.size || '';
    const material = row.material || '';
    const gender = (row.gender?.toLowerCase() as any) || 'unisex';
    const ageGroup = (row.age_group?.toLowerCase() as any) || 'adult';
    const condition = (row.condition?.toLowerCase() as any) || 'new';

    const merchantData: MerchantData = {
      id,
      link,
      title,
      description,
      image_link: imageLink,
      additional_image_link: additionalImageLink,
      google_product_category: googleProductCategory,
      product_type: productType,
      price,
      sale_price: salePrice,
      availability: ['in_stock', 'out_of_stock', 'preorder', 'backorder'].includes(availability)
        ? availability
        : 'in_stock',
      brand,
      gtin,
      mpn,
      identifier_exists: ['yes', 'no'].includes(identifierExists) ? identifierExists : 'no',
      item_group_id: itemGroupId,
      color,
      size,
      material,
      gender: ['unisex', 'male', 'female', ''].includes(gender) ? gender : 'unisex',
      age_group: ['adult', 'all_ages', 'teen', 'kids', 'toddler', 'infant', ''].includes(ageGroup) ? ageGroup : 'adult',
      condition: ['new', 'refurbished', 'used'].includes(condition) ? condition : 'new',
      custom_label_0: row.custom_label_0 || '',
      custom_label_1: row.custom_label_1 || '',
      custom_label_2: row.custom_label_2 || '',
      custom_label_3: row.custom_label_3 || '',
      custom_label_4: row.custom_label_4 || '',
    };

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
        price: 1.0,
        imported_data: 0.9,
      },
      variants: [],
      images: [imageLink].filter(Boolean),
      userCorrections: {},
    };

    const giftIntelligence: GiftIntelligence = {
      theme: row.custom_label_3 || '',
      subtheme: '',
      targetAudience: row.custom_label_0 ? [row.custom_label_0] : [],
      recipientPersonas: [],
      occasions: [],
      primaryGiftIntent: '',
      secondaryGiftIntents: [],
      searchConcepts: [],
    };

    const product: ProductItem = {
      id,
      status: 'not_analyzed',
      evidence,
      merchantData,
      giftIntelligence,
      titleCandidates: [],
      originalImported: { ...merchantData },
      appliedSuggestions: [],
      history: [
        {
          timestamp: now,
          note: 'Initial import from CSV',
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
  });
}

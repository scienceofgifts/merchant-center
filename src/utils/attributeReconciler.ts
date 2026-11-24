import { ProductItem, ProductVariant, VerifiedAttributes, MerchantData } from '../types/feed';

export interface AttributeDiscrepancy {
  field: 'size' | 'color' | 'material' | 'google_product_category' | 'product_type';
  currentValue: string;
  proposedValue: string;
  status: 'supported' | 'contradicted' | 'unresolved' | 'user_override';
  evidenceSource: string;
  reason: string;
  isSafeToFix: boolean;
}

/**
 * Standardizes dimension strings into clean Merchant Center format (e.g. '18" x 24"')
 */
export function formatDimensions(raw: string): string {
  const match = raw.match(/(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?\s*x\s*(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?/i);
  if (match) {
    return `${match[1]}" x ${match[2]}"`;
  }
  return raw.trim();
}

/**
 * Formats size options array into a clean range or list (e.g. 'S - 3XL')
 */
export function formatSizeRange(sizes: string[]): string {
  const cleanSizes = Array.from(new Set(sizes.map((s) => s.trim()))).filter(Boolean);
  if (cleanSizes.length === 0) return '';
  if (cleanSizes.length === 1) return cleanSizes[0];

  // Standard apparel order
  const order = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
  const sorted = [...cleanSizes].sort((a, b) => {
    const idxA = order.indexOf(a.toUpperCase());
    const idxB = order.indexOf(b.toUpperCase());
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    return a.localeCompare(b);
  });

  if (sorted.length > 2 && order.includes(sorted[0].toUpperCase()) && order.includes(sorted[sorted.length - 1].toUpperCase())) {
    return `${sorted[0]} - ${sorted[sorted.length - 1]}`;
  }

  return sorted.join(', ');
}

/**
 * Normalizes size strings for comparison across whitespace, capitalization, and common unit formats (e.g. '20 oz' vs '20oz')
 */
export function normalizeSize(size: string): string {
  if (!size || typeof size !== 'string') return '';
  return size
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/ounces?/g, 'oz')
    .replace(/(?:inches?|")/g, 'in');
}

/**
 * Determines whether a ProductItem represents a specific variant rather than a parent product
 */
export function isSpecificVariantItem(item: ProductItem): { isVariant: boolean; matchedVariant?: ProductVariant } {
  const variants = item.evidence?.variants || [];
  if (variants.length === 0) {
    return { isVariant: false };
  }

  // 1. Check ID/SKU match
  const itemId = item.id.toLowerCase();
  const itemMpn = (item.merchantData.mpn || '').toLowerCase();
  const itemGtin = (item.merchantData.gtin || '').toLowerCase();

  for (const v of variants) {
    const vId = (v.id || '').toLowerCase();
    const vSku = (v.sku || '').toLowerCase();
    if (vId && (itemId === vId || itemId.endsWith(`_${vId}`) || itemId.endsWith(`-${vId}`))) {
      return { isVariant: true, matchedVariant: v };
    }
    if (vSku && (itemId === vSku || itemMpn === vSku || itemGtin === vSku)) {
      return { isVariant: true, matchedVariant: v };
    }
  }

  // 2. Check title suffix for variant spec (e.g. "Civil War T-Shirt - Black / L")
  const title = item.merchantData?.title || item.evidence?.pageTitle || '';
  for (const v of variants) {
    if (v.title && v.title.length > 1 && title.toLowerCase().includes(v.title.toLowerCase())) {
      return { isVariant: true, matchedVariant: v };
    }
  }

  return { isVariant: false };
}

/**
 * Detects dimensional specifications in text (e.g. for posters, prints, artwork, canvases, journals)
 */
export function detectDimensionFromEvidence(item: ProductItem): string | undefined {
  const verified = item.evidence?.verifiedAttributes || {};
  if (verified.dimensions) return formatDimensions(verified.dimensions);

  // Check verified size if already formatted as dimension
  if (verified.size && /\d+\s*(?:"|in|inch|inches)?\s*x\s*\d+/i.test(verified.size)) {
    return formatDimensions(verified.size);
  }

  // Search in description, page title, merchant data
  const combinedText = [
    item.evidence?.pageTitle,
    item.evidence?.rawDescription,
    item.merchantData?.title,
    item.merchantData?.description,
  ].filter(Boolean).join(' ');

  const dimMatch = combinedText.match(/\b(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?\s*x\s*(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?\b/i);
  if (dimMatch) {
    return `${dimMatch[1]}" x ${dimMatch[2]}"`;
  }

  return undefined;
}

/**
 * Detects capacity specifications in text (e.g. for mugs, tumblers, drinkware)
 */
export function detectCapacityFromEvidence(item: ProductItem): string | undefined {
  const verified = item.evidence?.verifiedAttributes || {};
  if (verified.capacity) return verified.capacity;
  if (verified.size && /\b\d+(\.\d+)?\s*(?:oz|ounce|ounces)\b/i.test(verified.size)) {
    return verified.size;
  }

  const variants = item.evidence?.variants || [];
  for (const v of variants) {
    if (v.size && /\b\d+(\.\d+)?\s*(?:oz|ounce|ounces)\b/i.test(v.size)) {
      return v.size;
    }
  }

  const combinedText = [
    item.evidence?.pageTitle,
    item.evidence?.rawDescription,
    item.merchantData?.title,
    item.merchantData?.description,
  ].filter(Boolean).join(' ');

  const multiMatch = combinedText.match(/\b(11\s*oz(?:\s*(?:and|&|\/)\s*15\s*oz)?|15\s*oz)\b/i);
  if (multiMatch) {
    return multiMatch[0].replace(/\s+/g, ' ');
  }

  const capMatch = combinedText.match(/\b(\d+(?:\.\d+)?)\s*oz\b/i);
  if (capMatch) {
    return capMatch[0];
  }

  return undefined;
}

/**
 * Detects material from evidence
 */
export function isProductMaterialCompatible(material: string, item: ProductItem): boolean {
  const matLower = material.toLowerCase();
  const titleText = [
    item.evidence?.pageTitle,
    item.merchantData?.title,
  ].filter(Boolean).join(' ').toLowerCase();

  const isDrinkwareTitle =
    titleText.includes('mug') ||
    titleText.includes('cup') ||
    titleText.includes('drinkware') ||
    titleText.includes('glass') ||
    titleText.includes('tumbler') ||
    titleText.includes('whiskey') ||
    titleText.includes('shot glass') ||
    titleText.includes('stemless') ||
    titleText.includes('water bottle') ||
    titleText.includes('travel mug');

  const isPosterTitle =
    !isDrinkwareTitle &&
    (titleText.includes('poster') || titleText.includes('wall art') || titleText.includes('art print'));

  const isApparelTitle =
    !isDrinkwareTitle && !isPosterTitle &&
    (titleText.includes('hoodie') || titleText.includes('sweatshirt') || titleText.includes('t-shirt') || titleText.includes('shirt') || titleText.includes('tee') || titleText.includes('hat') || titleText.includes('cap') || titleText.includes('beanie') || titleText.includes('socks'));

  const isDrinkware = isDrinkwareTitle || (!isApparelTitle && !isPosterTitle && item.merchantData?.google_product_category?.toLowerCase().includes('drinkware'));
  const isPoster = isPosterTitle || (!isApparelTitle && !isDrinkware && item.merchantData?.google_product_category?.toLowerCase().includes('posters'));
  const isApparel = isApparelTitle || (!isDrinkware && !isPoster && item.merchantData?.google_product_category?.toLowerCase().includes('clothing'));

  if (isDrinkware && (matLower.includes('cotton') || matLower.includes('paper') || matLower.includes('twill') || matLower.includes('canvas') || matLower.includes('polyester') || matLower.includes('fleece'))) {
    return false;
  }
  if (isPoster && (matLower.includes('cotton') || (matLower.includes('glass') && !matLower.includes('framed')) || matLower.includes('twill') || matLower.includes('polyester'))) {
    return false;
  }
  if (isApparel && (matLower.includes('glass') || (matLower.includes('paper') && !matLower.includes('hardcover')) || matLower.includes('museum-grade') || matLower.includes('ceramic') || matLower.includes('crystal') || matLower.includes('porcelain'))) {
    return false;
  }
  return true;
}

/**
 * Detects material from evidence in a product-type-aware manner
 */
export function detectMaterialFromEvidence(item: ProductItem): string | undefined {
  const verified = item.evidence?.verifiedAttributes || {};
  if (verified.material && verified.material.trim()) {
    const mat = verified.material.trim();
    if (isProductMaterialCompatible(mat, item)) {
      return mat;
    }
  }

  const titleText = [
    item.evidence?.pageTitle,
    item.merchantData?.title,
  ].filter(Boolean).join(' ').toLowerCase();

  const combined = [
    item.evidence?.pageTitle,
    item.evidence?.rawDescription,
    item.merchantData?.title,
    item.merchantData?.description,
  ].filter(Boolean).join(' ').toLowerCase();

  const isDrinkwareTitle =
    titleText.includes('mug') ||
    titleText.includes('cup') ||
    titleText.includes('drinkware') ||
    titleText.includes('glass') ||
    titleText.includes('tumbler') ||
    titleText.includes('whiskey') ||
    titleText.includes('shot glass') ||
    titleText.includes('stemless') ||
    titleText.includes('water bottle') ||
    titleText.includes('travel mug');

  const isPosterTitle =
    !isDrinkwareTitle &&
    (titleText.includes('poster') || titleText.includes('wall art') || titleText.includes('art print'));

  const isApparelTitle =
    !isDrinkwareTitle && !isPosterTitle &&
    (titleText.includes('hoodie') || titleText.includes('sweatshirt') || titleText.includes('t-shirt') || titleText.includes('shirt') || titleText.includes('tee') || titleText.includes('hat') || titleText.includes('cap') || titleText.includes('beanie') || titleText.includes('socks') || titleText.includes('sweater') || titleText.includes('jacket'));

  const isDrinkware = isDrinkwareTitle || (!isApparelTitle && !isPosterTitle && (item.merchantData?.google_product_category?.toLowerCase().includes('drinkware') || item.merchantData?.google_product_category?.toLowerCase().includes('mugs')));
  const isPoster = isPosterTitle || (!isApparelTitle && !isDrinkware && item.merchantData?.google_product_category?.toLowerCase().includes('posters'));
  const isApparel = isApparelTitle || (!isDrinkware && !isPoster && (combined.includes('hoodie') || combined.includes('t-shirt') || combined.includes('shirt') || combined.includes('sweater') || item.merchantData?.google_product_category?.toLowerCase().includes('clothing') || item.merchantData?.google_product_category?.toLowerCase().includes('apparel')));

  const isFramed = combined.includes('framed') || combined.includes('frame');

  if (isDrinkware) {
    if (/\b(stainless\s*steel|stainless|18\/8|insulated\s*steel|metal\s*tumbler|steel)\b/i.test(combined)) {
      return 'Stainless Steel';
    }
    if (/\b(ceramic|porcelain|stoneware|clay)\b/i.test(combined)) {
      return 'Ceramic';
    }
    if (/\b(crystal)\b/i.test(combined)) {
      return 'Crystal';
    }
    if (/\b(glass|stemless\s*glass|pint\s*glass)\b/i.test(combined)) {
      return 'Glass';
    }
    if (combined.includes('tumbler') || combined.includes('travel mug') || combined.includes('water bottle')) {
      return 'Stainless Steel';
    }
    if (combined.includes('mug') || combined.includes('coffee cup')) {
      return 'Ceramic';
    }
    return undefined;
  }

  if (isPoster) {
    if (isFramed) {
      if (combined.includes('wood') || combined.includes('wooden')) return 'Museum-grade Matte Paper with Wood Frame';
      if (combined.includes('metal')) return 'Museum-grade Matte Paper with Metal Frame';
      return 'Museum-grade Matte Paper with Frame';
    }
    if (combined.includes('canvas')) return 'Canvas';
    return 'Museum-grade Matte Paper';
  }

  if (isApparel) {
    // 1. Explicit polyester
    if (/\b(100%\s*polyester|high-quality polyester|durable polyester|polyester fabric|100%\s*poly)\b/i.test(combined)) {
      return 'Polyester';
    }
    // 2. Cotton / poly blend or fleece
    if (/\b(cotton\s*\/\s*polyester blend|cotton blend|poly\/cotton|cotton-poly|polyester blend|fleece)\b/i.test(combined)) {
      return 'Cotton / Polyester Blend';
    }
    // 3. Standalone polyester if not a blend
    if (/\bpolyester\b/i.test(combined) && !/\bcotton\b/i.test(combined)) {
      return 'Polyester';
    }
    // 4. 100% cotton / ring-spun / combed
    if (/\b(100%\s*cotton|ring-spun cotton|combed cotton|pure cotton|heavy cotton)\b/i.test(combined)) {
      return '100% Cotton';
    }
    // 5. Cotton twill (require explicit twill or explicit headwear with word boundaries)
    if (/\b(cotton twill|twill)\b/i.test(combined) || (/\b(baseball cap|dad cap|trucker cap|bucket hat)\b/i.test(combined) && /\b(twill|cotton)\b/i.test(combined))) {
      return '100% Cotton Twill';
    }
    // 6. General cotton mention
    if (/\bcotton\b/i.test(combined)) {
      return '100% Cotton';
    }
    // If current material is already a valid compatible apparel material, preserve it
    const currentMat = item.merchantData?.material?.trim();
    if (currentMat && isProductMaterialCompatible(currentMat, item)) {
      return currentMat;
    }
    return undefined;
  }

  return undefined;
}

export function isValidColorName(color: string): boolean {
  if (!color || typeof color !== 'string') return false;
  const c = color.trim().toLowerCase();
  if (c.length < 2 || c.length > 30) return false;

  const blacklistedValues = new Set([
    'all',
    'default',
    'default title',
    'none',
    'n/a',
    'na',
    'one size',
    'os',
    'select',
    'standard',
    'various',
    'multi',
    'multicolor',
    'multi-color',
    'knitted',
    'unknown',
    'null',
    'undefined',
    'other',
  ]);

  if (blacklistedValues.has(c)) {
    return false;
  }

  if (c === 'one size' || c.includes('science of gifts') || c.includes('out of stock') || c.includes('in stock') || c.includes('generic brand')) {
    return false;
  }

  if (/^\d+(\.\d+)?\s*(x|\"|in|oz|ml)/i.test(c)) return false;
  if (/\b\d+\s*x\s*\d+\b/i.test(c)) return false;

  const invalidTokens = new Set([
    'all', 'default', 'none', 'na', 'select', 'standard', 'various', 'multi', 'multicolor',
    'size', 'os', 'small', 'medium', 'large', 'xl', '2xl', '3xl', '4xl', '5xl',
    'brand', 'generic', 'unisex', 'adult', 'youth', 'kids', 'men', 'women', 'new',
    'hoodie', 'sweatshirt', 't-shirt', 'shirt', 'tee', 'hat', 'cap', 'beanie', 'socks',
    'mug', 'cup', 'glass', 'tumbler', 'poster', 'print', 'canvas', 'tote', 'bag',
    'sweater', 'jacket', 'knitted', 'knit', 'woven', 'crochet', 'ribbed', 'braided',
    'embroidered', 'embroidery', 'unstructured', 'structured', 'distressed', 'vintage',
    'classic', 'fitted', 'relaxed', 'stretch', 'seamless', 'stitch', 'fleece', 'twill',
    'denim', 'linen', 'wool', 'polyester', 'spandex', 'nylon', 'leather', 'suede',
    'acrylic', 'silk', 'satin', 'velvet', 'cotton', 'paper', 'ceramic', 'porcelain',
    'wood', 'metal', 'crystal', 'crewneck', 'pullover', 'zipper', 'button', 'pocket',
    'inch', 'inches', 'cm', 'mm', 'oz', 'ml', 'ounce', 'ounces'
  ]);

  const tokens = c.split(/[\s,/_+()-]+/).filter(Boolean);
  for (const t of tokens) {
    if (invalidTokens.has(t)) return false;
  }

  return /[a-z]/i.test(c);
}

/**
 * Detects color from evidence
 */
export function detectColorFromEvidence(item: ProductItem): string | undefined {
  const verified = item.evidence?.verifiedAttributes || {};
  if (verified.color && verified.color.trim()) {
    const col = verified.color.trim();
    if (isValidColorName(col)) {
      return col;
    }
  }

  // Check variants
  const variants = item.evidence?.variants || [];
  for (const v of variants) {
    if (v.color && v.color.trim() && isValidColorName(v.color)) {
      return v.color.trim();
    }
  }

  const text = [
    item.evidence?.pageTitle,
    item.evidence?.rawDescription,
    item.merchantData?.title,
  ].filter(Boolean).join(' ').toLowerCase();

  const knownColors = [
    { name: 'Heather Charcoal', regex: /\bheather charcoal\b/i },
    { name: 'Black', regex: /\b(black|monochrome|black-and-white|black & white)\b/i },
    { name: 'White', regex: /\b(white|glossy white)\b/i },
    { name: 'Navy', regex: /\b(navy|navy blue)\b/i },
    { name: 'Charcoal', regex: /\bcharcoal\b/i },
    { name: 'Sport Grey', regex: /\bsport gre?y\b/i },
    { name: 'Red', regex: /\bred\b/i },
    { name: 'Maroon', regex: /\bmaroon\b/i },
    { name: 'Natural', regex: /\b(natural|cream|off-white)\b/i },
    { name: 'Royal Blue', regex: /\broyal blue\b/i },
  ];

  for (const c of knownColors) {
    if (c.regex.test(text)) {
      return c.name;
    }
  }

  return undefined;
}

/**
 * Reconciles all product attributes against source evidence, user overrides, and variants
 */
export function reconcileProductAttributes(item: ProductItem): AttributeDiscrepancy[] {
  const discrepancies: AttributeDiscrepancy[] = [];
  const md = item.merchantData || {} as MerchantData;
  const userCorrections = item.evidence?.userCorrections || {};
  const verified = item.evidence?.verifiedAttributes || {};
  const variants = item.evidence?.variants || [];

  const combinedText = [
    item.evidence?.pageTitle,
    item.evidence?.rawDescription,
    md.title,
    md.description,
  ].filter(Boolean).join(' ').toLowerCase();

  const hasApparelKeywords =
    combinedText.includes('hoodie') ||
    combinedText.includes('sweatshirt') ||
    combinedText.includes('t-shirt') ||
    combinedText.includes('shirt') ||
    combinedText.includes('tee') ||
    combinedText.includes('apparel') ||
    combinedText.includes('hat') ||
    combinedText.includes('cap') ||
    combinedText.includes('beanie');

  const hasNonApparelKeywords =
    combinedText.includes('poster') ||
    combinedText.includes('wall art') ||
    combinedText.includes('art print') ||
    combinedText.includes('mug') ||
    combinedText.includes('cup') ||
    combinedText.includes('drinkware') ||
    combinedText.includes('glass') ||
    combinedText.includes('whiskey') ||
    combinedText.includes('tumbler');

  const isApparel = hasApparelKeywords || (md.google_product_category?.toLowerCase().includes('clothing') && !hasNonApparelKeywords);

  const isPoster =
    !isApparel &&
    (combinedText.includes('poster') ||
     combinedText.includes('wall art') ||
     combinedText.includes('art print') ||
     md.google_product_category?.toLowerCase().includes('posters, prints & visual artwork'));

  const isMug =
    !isApparel &&
    (combinedText.includes('mug') ||
     combinedText.includes('cup') ||
     combinedText.includes('drinkware') ||
     combinedText.includes('glass') ||
     combinedText.includes('whiskey') ||
     combinedText.includes('tumbler') ||
     md.google_product_category?.toLowerCase().includes('mugs') ||
     md.google_product_category?.toLowerCase().includes('drinkware'));

  // ==========================================
  // 1. SIZE RECONCILIATION
  // ==========================================
  const currentSize = (md.size || '').trim();
  const userSizeOverride = userCorrections.size;

  if (userSizeOverride && userSizeOverride.trim() && userSizeOverride === currentSize) {
    discrepancies.push({
      field: 'size',
      currentValue: currentSize,
      proposedValue: currentSize,
      status: 'user_override',
      evidenceSource: 'User-approved override',
      reason: 'User explicitly set and approved this size value.',
      isSafeToFix: false,
    });
  } else if (isPoster) {
    const dim = detectDimensionFromEvidence(item);
    if (dim) {
      const isContradicted =
        !currentSize ||
        currentSize.toUpperCase() === 'M' ||
        currentSize.toLowerCase() === 'one size' ||
        currentSize.toLowerCase() === 'os' ||
        (normalizeSize(currentSize) !== normalizeSize(dim) && !currentSize.includes(dim.replace(/"/g, '')));

      if (isContradicted) {
        discrepancies.push({
          field: 'size',
          currentValue: currentSize,
          proposedValue: dim,
          status: 'contradicted',
          evidenceSource: 'Source dimensions specification',
          reason: `Posters and wall art require dimensional specifications (${dim}) rather than apparel size "${currentSize || 'empty'}".`,
          isSafeToFix: true,
        });
      } else {
        discrepancies.push({
          field: 'size',
          currentValue: currentSize,
          proposedValue: currentSize,
          status: 'supported',
          evidenceSource: 'Source dimensions specification',
          reason: 'Size correctly matches verified poster dimensions.',
          isSafeToFix: false,
        });
      }
    } else if (currentSize.toUpperCase() === 'M' || currentSize.toLowerCase() === 'one size') {
      discrepancies.push({
        field: 'size',
        currentValue: currentSize,
        proposedValue: '',
        status: 'contradicted',
        evidenceSource: 'Product form factor (Poster)',
        reason: `Size "${currentSize}" is an apparel size and invalid for a poster. Provenance is unverified.`,
        isSafeToFix: false,
      });
    } else if (currentSize) {
      discrepancies.push({
        field: 'size',
        currentValue: currentSize,
        proposedValue: currentSize,
        status: 'unresolved',
        evidenceSource: 'Catalog data',
        reason: 'Current size has unknown provenance; no explicit dimension evidence found.',
        isSafeToFix: false,
      });
    }
  } else if (isMug) {
    const cap = detectCapacityFromEvidence(item);
    if (cap) {
      const isContradicted =
        !currentSize ||
        currentSize.toUpperCase() === 'M' ||
        currentSize.toLowerCase() === 'one size' ||
        normalizeSize(currentSize) !== normalizeSize(cap);

      if (isContradicted) {
        discrepancies.push({
          field: 'size',
          currentValue: currentSize,
          proposedValue: cap,
          status: 'contradicted',
          evidenceSource: 'Source capacity specification',
          reason: `Drinkware requires capacity specifications (${cap}) rather than apparel size "${currentSize || 'empty'}".`,
          isSafeToFix: true,
        });
      } else {
        discrepancies.push({
          field: 'size',
          currentValue: currentSize,
          proposedValue: currentSize,
          status: 'supported',
          evidenceSource: 'Source capacity specification',
          reason: 'Size correctly matches verified drinkware capacity.',
          isSafeToFix: false,
        });
      }
    } else if (currentSize.toUpperCase() === 'M' || currentSize.toLowerCase() === 'one size') {
      discrepancies.push({
        field: 'size',
        currentValue: currentSize,
        proposedValue: '',
        status: 'contradicted',
        evidenceSource: 'Product form factor (Drinkware)',
        reason: `Size "${currentSize}" is an apparel size and invalid for drinkware. Provenance is unverified.`,
        isSafeToFix: false,
      });
    } else if (currentSize) {
      discrepancies.push({
        field: 'size',
        currentValue: currentSize,
        proposedValue: currentSize,
        status: 'unresolved',
        evidenceSource: 'Catalog data',
        reason: 'Current size has unknown provenance; no explicit capacity evidence found.',
        isSafeToFix: false,
      });
    }
  } else if (isApparel) {
    const variantCheck = isSpecificVariantItem(item);

    if (variantCheck.isVariant && variantCheck.matchedVariant?.size) {
      const variantSize = variantCheck.matchedVariant.size;
      if (normalizeSize(currentSize) !== normalizeSize(variantSize)) {
        discrepancies.push({
          field: 'size',
          currentValue: currentSize,
          proposedValue: variantSize,
          status: 'contradicted',
          evidenceSource: `Variant specification (${variantCheck.matchedVariant.title || variantCheck.matchedVariant.id})`,
          reason: `Item represents a specific variant (${variantSize}) rather than "${currentSize}".`,
          isSafeToFix: true,
        });
      } else {
        discrepancies.push({
          field: 'size',
          currentValue: currentSize,
          proposedValue: currentSize,
          status: 'supported',
          evidenceSource: 'Variant specification',
          reason: 'Matches verified variant size.',
          isSafeToFix: false,
        });
      }
    } else {
      const variantSizes = variants.map((v: ProductVariant) => v.size).filter(Boolean) as string[];
      let expectedApparelSize = '';

      if (variantSizes.length > 0) {
        expectedApparelSize = formatSizeRange(variantSizes);
      } else if (verified.size && verified.size.trim()) {
        expectedApparelSize = verified.size.trim();
      }

      if (expectedApparelSize) {
        const isMultipleSizesExposed = variantSizes.length > 1;
        const isCurrentSizeAMember = variantSizes.some(
          (s) => normalizeSize(s) === normalizeSize(currentSize)
        );
        const hasUserOverride = Boolean(userCorrections.size && userCorrections.size === currentSize);

        if (isMultipleSizesExposed && hasUserOverride && normalizeSize(currentSize) !== normalizeSize(expectedApparelSize)) {
          discrepancies.push({
            field: 'size',
            currentValue: currentSize,
            proposedValue: expectedApparelSize,
            status: 'unresolved',
            evidenceSource: 'Parent product with multiple variant sizes (User override preserved)',
            reason: `Source exposes multiple sizes (${expectedApparelSize}) but has user-approved override "${currentSize}". Flagging ambiguity/preserving override.`,
            isSafeToFix: false,
          });
        } else if (isCurrentSizeAMember) {
          // Current size is a verified variant size offered by the source
          discrepancies.push({
            field: 'size',
            currentValue: currentSize,
            proposedValue: currentSize,
            status: 'supported',
            evidenceSource: 'Product options & variant availability',
            reason: `Size "${currentSize}" correctly matches a verified available variant offering.`,
            isSafeToFix: false,
          });
        } else if (normalizeSize(currentSize) === normalizeSize(expectedApparelSize)) {
          discrepancies.push({
            field: 'size',
            currentValue: currentSize,
            proposedValue: currentSize,
            status: 'supported',
            evidenceSource: 'Product options & specifications',
            reason: 'Size correctly matches verified apparel size options.',
            isSafeToFix: false,
          });
        } else {
          // Current size is missing or does not match any offered variant
          const isContradicted =
            !currentSize ||
            currentSize.toLowerCase() === 'one size' ||
            currentSize.toLowerCase() === 'os' ||
            variantSizes.length > 0;

          if (isContradicted) {
            discrepancies.push({
              field: 'size',
              currentValue: currentSize,
              proposedValue: expectedApparelSize,
              status: 'contradicted',
              evidenceSource: 'Product options & variant availability',
              reason: !currentSize
                ? `Size is missing; populating verified size range (${expectedApparelSize}).`
                : `Current size "${currentSize}" is not an available option; replacing with verified size range (${expectedApparelSize}).`,
              isSafeToFix: true,
            });
          } else {
            discrepancies.push({
              field: 'size',
              currentValue: currentSize,
              proposedValue: currentSize,
              status: 'unresolved',
              evidenceSource: 'Catalog data',
              reason: 'Current size has unknown provenance; no explicit variant match.',
              isSafeToFix: false,
            });
          }
        }
      } else if (currentSize) {
        discrepancies.push({
          field: 'size',
          currentValue: currentSize,
          proposedValue: currentSize,
          status: 'unresolved',
          evidenceSource: 'Catalog data',
          reason: 'Current size has unknown provenance; no explicit size evidence found in source.',
          isSafeToFix: false,
        });
      }
    }
  } else if (currentSize) {
    const dim = detectDimensionFromEvidence(item);
    if (dim && normalizeSize(currentSize) !== normalizeSize(dim)) {
      discrepancies.push({
        field: 'size',
        currentValue: currentSize,
        proposedValue: dim,
        status: 'contradicted',
        evidenceSource: 'Source dimensions specification',
        reason: `Product requires dimensional size (${dim}) rather than "${currentSize}".`,
        isSafeToFix: true,
      });
    } else {
      discrepancies.push({
        field: 'size',
        currentValue: currentSize,
        proposedValue: currentSize,
        status: 'unresolved',
        evidenceSource: 'Catalog data',
        reason: 'Current size has unknown provenance.',
        isSafeToFix: false,
      });
    }
  }

  // ==========================================
  // 2. COLOR RECONCILIATION
  // ==========================================
  const currentColor = (md.color || '').trim();
  const userColorOverride = userCorrections.color;

  if (userColorOverride && userColorOverride.trim() && userColorOverride === currentColor) {
    discrepancies.push({
      field: 'color',
      currentValue: currentColor,
      proposedValue: currentColor,
      status: 'user_override',
      evidenceSource: 'User-approved override',
      reason: 'User explicitly set and approved this color value.',
      isSafeToFix: false,
    });
  } else {
    const detectedColor = detectColorFromEvidence(item);
    const isCurrentColorValid = isValidColorName(currentColor);

    if (!isCurrentColorValid && currentColor) {
      discrepancies.push({
        field: 'color',
        currentValue: currentColor,
        proposedValue: detectedColor || '',
        status: 'contradicted',
        evidenceSource: 'Attribute semantic validation',
        reason: `Current color "${currentColor}" is an invalid color string (contains size, brand, or metadata).`,
        isSafeToFix: Boolean(detectedColor),
      });
    } else if (detectedColor) {
      if (!currentColor) {
        discrepancies.push({
          field: 'color',
          currentValue: '',
          proposedValue: detectedColor,
          status: 'contradicted',
          evidenceSource: 'Source page specifications & title',
          reason: `Color is missing and can be populated from verified source color "${detectedColor}".`,
          isSafeToFix: true,
        });
      } else if (currentColor.toLowerCase() !== detectedColor.toLowerCase()) {
        discrepancies.push({
          field: 'color',
          currentValue: currentColor,
          proposedValue: detectedColor,
          status: 'contradicted',
          evidenceSource: 'Source page specifications & title',
          reason: `Current color "${currentColor}" contradicts verified source evidence "${detectedColor}".`,
          isSafeToFix: true,
        });
      } else {
        discrepancies.push({
          field: 'color',
          currentValue: currentColor,
          proposedValue: currentColor,
          status: 'supported',
          evidenceSource: 'Source page specifications',
          reason: 'Color correctly matches verified source evidence.',
          isSafeToFix: false,
        });
      }
    } else if (currentColor) {
      discrepancies.push({
        field: 'color',
        currentValue: currentColor,
        proposedValue: currentColor,
        status: 'unresolved',
        evidenceSource: 'Catalog data',
        reason: 'Color has unknown provenance; no explicit color evidence found in source.',
        isSafeToFix: false,
      });
    }
  }

  // ==========================================
  // 3. MATERIAL RECONCILIATION
  // ==========================================
  const currentMaterial = (md.material || '').trim();
  const userMaterialOverride = userCorrections.material;

  if (userMaterialOverride && userMaterialOverride.trim() && userMaterialOverride === currentMaterial) {
    discrepancies.push({
      field: 'material',
      currentValue: currentMaterial,
      proposedValue: currentMaterial,
      status: 'user_override',
      evidenceSource: 'User-approved override',
      reason: 'User explicitly set and approved this material value.',
      isSafeToFix: false,
    });
  } else {
    const detectedMaterial = detectMaterialFromEvidence(item);
    if (detectedMaterial) {
      if (!currentMaterial) {
        discrepancies.push({
          field: 'material',
          currentValue: '',
          proposedValue: detectedMaterial,
          status: 'contradicted',
          evidenceSource: 'Source page specifications & description',
          reason: `Material is missing and can be populated from verified source material "${detectedMaterial}".`,
          isSafeToFix: true,
        });
      } else if (
        currentMaterial.toLowerCase() !== detectedMaterial.toLowerCase() &&
        (currentMaterial.toLowerCase() === 'paper' ||
          !detectedMaterial.toLowerCase().includes(currentMaterial.toLowerCase()))
      ) {
        discrepancies.push({
          field: 'material',
          currentValue: currentMaterial,
          proposedValue: detectedMaterial,
          status: 'contradicted',
          evidenceSource: 'Source page specifications & description',
          reason: `Current material "${currentMaterial}" contradicts explicit source specifications ("${detectedMaterial}").`,
          isSafeToFix: true,
        });
      } else {
        discrepancies.push({
          field: 'material',
          currentValue: currentMaterial,
          proposedValue: currentMaterial,
          status: 'supported',
          evidenceSource: 'Source page specifications',
          reason: 'Material correctly matches verified source specifications.',
          isSafeToFix: false,
        });
      }
    } else if (currentMaterial) {
      discrepancies.push({
        field: 'material',
        currentValue: currentMaterial,
        proposedValue: currentMaterial,
        status: 'unresolved',
        evidenceSource: 'Catalog data',
        reason: 'Material has unknown provenance; no explicit material evidence found in source.',
        isSafeToFix: false,
      });
    }
  }

  // ==========================================
  // 4. GOOGLE PRODUCT CATEGORY RECONCILIATION
  // ==========================================
  const currentGpc = (md.google_product_category || '').trim();
  if (isPoster && currentGpc.toLowerCase().includes('clothing')) {
    discrepancies.push({
      field: 'google_product_category',
      currentValue: currentGpc,
      proposedValue: 'Home & Garden > Decor > Artwork > Posters, Prints & Visual Artwork',
      status: 'contradicted',
      evidenceSource: 'Product form factor (Poster / Wall Art)',
      reason: 'Poster is mistakenly classified under Clothing in Google Product Category.',
      isSafeToFix: true,
    });
  } else if (isMug && currentGpc.toLowerCase().includes('clothing')) {
    discrepancies.push({
      field: 'google_product_category',
      currentValue: currentGpc,
      proposedValue: 'Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs',
      status: 'contradicted',
      evidenceSource: 'Product form factor (Drinkware / Mug)',
      reason: 'Mug is mistakenly classified under Clothing in Google Product Category.',
      isSafeToFix: true,
    });
  }

  // ==========================================
  // 5. PRODUCT TYPE RECONCILIATION
  // ==========================================
  const currentPt = (md.product_type || '').trim();
  if (isPoster && currentPt.toLowerCase().includes('hoodie')) {
    discrepancies.push({
      field: 'product_type',
      currentValue: currentPt,
      proposedValue: 'Home Decor > Wall Art > Historical Posters',
      status: 'contradicted',
      evidenceSource: 'Product form factor (Poster / Wall Art)',
      reason: 'Poster product type contradicts actual form factor.',
      isSafeToFix: true,
    });
  }

  return discrepancies;
}

/**
 * Returns suggested field updates for any contradicted attributes with high confidence
 */
export function getEvidenceAwareCorrections(item: ProductItem): Partial<MerchantData> {
  const discrepancies = reconcileProductAttributes(item);
  const updates: Partial<MerchantData> = {};

  for (const d of discrepancies) {
    if (d.status === 'contradicted' && d.isSafeToFix && d.proposedValue) {
      updates[d.field] = d.proposedValue as any;
    }
  }

  return updates;
}

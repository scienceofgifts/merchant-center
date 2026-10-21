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

  const capMatch = combinedText.match(/\b(11|12|15|16|20|32)\s*oz\b/i);
  if (capMatch) {
    return capMatch[0];
  }

  return undefined;
}

/**
 * Detects material from evidence
 */
export function detectMaterialFromEvidence(item: ProductItem): string | undefined {
  const verified = item.evidence?.verifiedAttributes || {};
  if (verified.material && verified.material.trim()) {
    return verified.material.trim();
  }

  const combined = [
    item.evidence?.pageTitle,
    item.evidence?.rawDescription,
    item.merchantData?.title,
    item.merchantData?.description,
  ].filter(Boolean).join(' ').toLowerCase();

  if (combined.includes('100% cotton') || combined.includes('ring-spun cotton') || combined.includes('combed cotton')) {
    return '100% Cotton';
  }
  if (combined.includes('cotton blend') || combined.includes('cotton / polyester blend') || combined.includes('poly/cotton') || combined.includes('fleece')) {
    return 'Cotton / Polyester Blend';
  }
  if (combined.includes('ceramic') || combined.includes('porcelain')) {
    return 'Ceramic';
  }
  if (
    combined.includes('museum-grade') ||
    combined.includes('archival paper') ||
    combined.includes('matte paper') ||
    combined.includes('poster paper') ||
    combined.includes('heavyweight paper') ||
    combined.includes('fine art paper')
  ) {
    return 'Museum-grade Matte Paper';
  }
  if (combined.includes('canvas')) {
    return 'Canvas';
  }
  if (combined.includes('hardcover') || combined.includes('journal') || combined.includes('notebook')) {
    return 'Matte Hardcover with Archival Paper';
  }
  if (combined.includes('twill') || combined.includes('cap') || combined.includes('hat')) {
    return '100% Cotton Twill';
  }

  return undefined;
}

/**
 * Detects color from evidence
 */
export function detectColorFromEvidence(item: ProductItem): string | undefined {
  const verified = item.evidence?.verifiedAttributes || {};
  if (verified.color && verified.color.trim()) {
    return verified.color.trim();
  }

  // Check variants
  const variants = item.evidence?.variants || [];
  const variantColors = variants.map((v: ProductVariant) => v.color).filter(Boolean) as string[];
  if (variantColors.length > 0) {
    return variantColors[0];
  }

  const text = [
    item.evidence?.pageTitle,
    item.evidence?.rawDescription,
    item.merchantData?.title,
  ].filter(Boolean).join(' ').toLowerCase();

  const knownColors = [
    { name: 'Heather Charcoal', regex: /\bheather charcoal\b/i },
    { name: 'Black', regex: /\b(black|monochrome)\b/i },
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

  const isApparel =
    combinedText.includes('hoodie') ||
    combinedText.includes('sweatshirt') ||
    combinedText.includes('t-shirt') ||
    combinedText.includes('shirt') ||
    combinedText.includes('tee') ||
    combinedText.includes('apparel') ||
    md.google_product_category?.toLowerCase().includes('clothing');

  const isPoster =
    !isApparel &&
    (/\b(posters?|prints?|wall art)\b/i.test(combinedText) ||
      md.google_product_category?.toLowerCase().includes('posters, prints & visual artwork'));

  const isMug =
    combinedText.includes('mug') ||
    combinedText.includes('cup') ||
    combinedText.includes('drinkware') ||
    md.google_product_category?.toLowerCase().includes('mugs');

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
        (currentSize !== dim && !currentSize.includes(dim.replace(/"/g, '')));

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
        currentSize !== cap;

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
      if (currentSize !== variantSize) {
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
        const isCurrentSizeAMember = variantSizes.includes(currentSize);
        const hasUserOverride = Boolean(userCorrections.size && userCorrections.size === currentSize);

        if (isMultipleSizesExposed && hasUserOverride && currentSize !== expectedApparelSize) {
          discrepancies.push({
            field: 'size',
            currentValue: currentSize,
            proposedValue: expectedApparelSize,
            status: 'unresolved',
            evidenceSource: 'Parent product with multiple variant sizes (User override preserved)',
            reason: `Source exposes multiple sizes (${expectedApparelSize}) but has user-approved override "${currentSize}". Flagging ambiguity/preserving override.`,
            isSafeToFix: false,
          });
        } else {
          const isSingleMWhenMultipleExist =
            currentSize.toUpperCase() === 'M' &&
            expectedApparelSize !== 'M' &&
            (variantSizes.length > 1 || expectedApparelSize.includes('-') || expectedApparelSize.includes(','));

          const isContradicted =
            !currentSize ||
            isSingleMWhenMultipleExist ||
            (currentSize !== expectedApparelSize && variantSizes.length > 1);

          if (isContradicted) {
            discrepancies.push({
              field: 'size',
              currentValue: currentSize,
              proposedValue: expectedApparelSize,
              status: 'contradicted',
              evidenceSource: 'Product options & variant availability',
              reason: `Parent apparel offering provides size range (${expectedApparelSize}); replacing manually entered single size "${currentSize || 'empty'}".`,
              isSafeToFix: true,
            });
          } else if (currentSize === expectedApparelSize) {
            discrepancies.push({
              field: 'size',
              currentValue: currentSize,
              proposedValue: currentSize,
              status: 'supported',
              evidenceSource: 'Product options & specifications',
              reason: 'Size correctly matches verified apparel size options.',
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
    if (dim && currentSize !== dim) {
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
    if (detectedColor) {
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

import { MerchantData, DeterministicValidation, ProductItem } from '../types/feed';

export function validateMerchantData(
  item: ProductItem,
  allCatalogItems: ProductItem[] = []
): DeterministicValidation {
  const blockingErrors: string[] = [];
  const warnings: string[] = [];
  const data = item.merchantData;

  // 1. Mandatory Core Fields
  if (!data.id || data.id.trim() === '') {
    blockingErrors.push('Product ID is missing (Required by Merchant Center)');
  }

  if (!data.title || data.title.trim() === '') {
    blockingErrors.push('Product Title is missing');
  } else {
    if (data.title.length > 150) {
      blockingErrors.push(`Title exceeds Google Merchant Center limit of 150 characters (Current: ${data.title.length} chars)`);
    } else if (data.title.length < 15) {
      warnings.push('Title is very short (< 15 chars). Consider adding essential product type and subject details.');
    }
  }

  if (!data.description || data.description.trim() === '') {
    blockingErrors.push('Product Description is missing');
  } else if (data.description.length > 5000) {
    blockingErrors.push(`Description exceeds 5000 characters (Current: ${data.description.length})`);
  } else if (data.description.length < 50) {
    warnings.push('Description is brief (< 50 chars). A more informative description helps product discovery.');
  }

  if (!data.link || data.link.trim() === '') {
    blockingErrors.push('Product Link (landing page URL) is missing');
  } else {
    try {
      const parsedUrl = new URL(data.link);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        blockingErrors.push('Product Link must start with http:// or https://');
      }
    } catch {
      blockingErrors.push(`Invalid Product Link URL: "${data.link}"`);
    }
  }

  if (!data.image_link || data.image_link.trim() === '') {
    blockingErrors.push('Product Image Link is missing');
  } else {
    try {
      const parsedUrl = new URL(data.image_link);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        blockingErrors.push('Image Link must start with http:// or https://');
      }
    } catch {
      blockingErrors.push(`Invalid Image Link URL: "${data.image_link}"`);
    }
  }

  // 2. Price Validation
  if (!data.price || data.price.trim() === '') {
    blockingErrors.push('Product Price is missing');
  } else {
    // Standard format: '29.99 USD' or '$29.99' or '29.99'
    const priceStr = data.price.replace(/[$,€£]/g, '').trim();
    const parts = priceStr.split(/\s+/);
    const num = parseFloat(parts[0]);
    if (isNaN(num) || num <= 0) {
      blockingErrors.push(`Invalid price format: "${data.price}". Example valid format: "29.99 USD" or "$29.99"`);
    }
  }

  // 3. Availability Validation
  const validAvailabilities = ['in_stock', 'out_of_stock', 'preorder', 'backorder'];
  if (!data.availability || !validAvailabilities.includes(data.availability)) {
    blockingErrors.push(`Invalid availability "${data.availability}". Must be in_stock, out_of_stock, preorder, or backorder`);
  }

  // 4. Identifiers (GTIN, MPN, Brand, identifier_exists)
  if (data.identifier_exists === 'yes') {
    if (!data.brand && !data.gtin && !data.mpn) {
      warnings.push('identifier_exists is "yes" but neither Brand, GTIN, nor MPN is provided.');
    }
    if (data.gtin) {
      // Check dummy/fake GTINs
      const cleanGtin = data.gtin.replace(/\D/g, '');
      if (cleanGtin.length < 8 || cleanGtin.length > 14 || /^0+$/.test(cleanGtin) || /^12345678/.test(cleanGtin)) {
        warnings.push(`GTIN "${data.gtin}" appears invalid or placeholder. Never invent GTINs.`);
      }
    }
  } else if (data.identifier_exists === 'no') {
    if (data.gtin) {
      warnings.push('identifier_exists is set to "no", but a GTIN is present. Either remove GTIN or set identifier_exists to "yes".');
    }
  } else {
    warnings.push('identifier_exists is not specified. Merchant Center expects "yes" or "no".');
  }

  // 5. Gender & Age Group validation for Apparel products
  const validGenders = ['unisex', 'male', 'female', ''];
  if (data.gender && !validGenders.includes(data.gender.toLowerCase())) {
    blockingErrors.push(`Invalid gender "${data.gender}". Must be unisex, male, female, or empty`);
  }

  const validAgeGroups = ['adult', 'all_ages', 'teen', 'kids', 'toddler', 'infant', ''];
  if (data.age_group && !validAgeGroups.includes(data.age_group.toLowerCase())) {
    blockingErrors.push(`Invalid age_group "${data.age_group}". Must be adult, all_ages, teen, kids, toddler, or infant`);
  }

  // 6. Google Product Category checks
  if (!data.google_product_category || data.google_product_category.trim() === '') {
    warnings.push('google_product_category is empty. Providing a standard Google category improves ad targeting.');
  } else if (data.google_product_category.toLowerCase().includes('gifts >')) {
    warnings.push('google_product_category contains "Gifts >". Google Product Category should be official taxonomy (e.g. Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs), not internal gift taxonomy.');
  }

  // 7. Duplicate Checks (if catalog list provided)
  if (allCatalogItems.length > 0) {
    const duplicatesId = allCatalogItems.filter(
      (other) => other.id !== item.id && other.merchantData.id && other.merchantData.id === data.id
    );
    if (duplicatesId.length > 0) {
      blockingErrors.push(`Duplicate ID "${data.id}" found across catalog (${duplicatesId.length + 1} products share this ID)`);
    }

    const duplicatesLink = allCatalogItems.filter(
      (other) => other.id !== item.id && other.merchantData.link && other.merchantData.link === data.link && other.merchantData.item_group_id !== data.item_group_id
    );
    if (duplicatesLink.length > 0 && !data.item_group_id) {
      warnings.push(`Same link "${data.link}" shared with other non-variant products.`);
    }
  }

  // 8. Variant consistency
  if (data.item_group_id && (!data.color && !data.size && !data.material)) {
    warnings.push('Product has item_group_id set (variant) but no distinguishing attribute like color, size, or material is filled.');
  }

  return {
    isValid: blockingErrors.length === 0,
    blockingErrors,
    warnings,
  };
}

export function computeProductStatus(
  item: ProductItem,
  allCatalogItems: ProductItem[] = []
): { status: ProductItem['status']; validation: DeterministicValidation } {
  const validation = validateMerchantData(item, allCatalogItems);

  if (!validation.isValid) {
    return { status: 'errors', validation };
  }

  if (validation.warnings.length > 0) {
    return { status: 'warnings', validation };
  }

  if (item.audit && item.audit.overallScore >= 85 && item.audit.criticalErrors.length === 0) {
    return { status: 'optimized', validation };
  }

  if (item.strategy && item.merchantData.title) {
    return { status: 'needs_review', validation };
  }

  return { status: 'not_analyzed', validation };
}

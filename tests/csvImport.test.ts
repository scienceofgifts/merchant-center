import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseCsvText,
  groupCsvRowsToProducts,
  convertParsedCsvToProducts,
  previewCsvCatalogImport,
  applyCsvCatalogImport,
  expandCatalogToExportRows,
  generateMerchantCenterCsv,
  generateMerchantCenterRssXml,
  validateExportedFeedRows,
  normalizeCanonicalProductUrl,
} from '../src/utils/csv';
import { ProductItem } from '../src/types/feed';

const HEADER = [
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
].join(',');

function csvRow(values: Partial<Record<string, string>>): string {
  const cols = HEADER.split(',');
  return cols
    .map((col) => {
      const val = values[col] ?? '';
      return /[",\n\r]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val;
    })
    .join(',');
}

function buildCsv(rows: Array<Partial<Record<string, string>>>): string {
  return [HEADER, ...rows.map(csvRow)].join('\n');
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
  } catch (err: any) {
    console.error(`  FAIL: ${name}`);
    console.error(err?.stack || err);
    process.exitCode = 1;
  }
}

console.log('Running CSV Import & Catalog Management Tests...\n');

// 1. Variant grouping by item_group_id and canonical URL normalization
test('groups multi-variant rows by item_group_id and normalized canonical URLs while preserving all variant attributes', () => {
  const csv = buildCsv([
    {
      id: 'var-tee-black-s',
      item_group_id: 'grp-dna-tee',
      title: 'DNA Helix Science T-Shirt',
      description: 'Soft ringspun cotton biology shirt with double helix illustration.',
      link: 'https://www.scienceofgifts.fourthwall.com/en-usd/products/dna-helix-tee?utm_source=gmc&variant=1',
      image_link: 'https://cdn.example.com/dna-black-s.jpg',
      additional_image_link: 'https://cdn.example.com/dna-detail.jpg',
      availability: 'in stock',
      price: '24.99 USD',
      sale_price: '21.99 USD',
      google_product_category: 'Apparel & Accessories > Clothing > Shirts & Tops',
      product_type: 'Science Gifts > Biology Shirts',
      brand: 'Science of Gifts',
      identifier_exists: 'no',
      color: 'Black',
      size: 'S',
      material: '100% Cotton',
      pattern: 'Graphic',
      gender: 'unisex',
      age_group: 'adult',
      condition: 'new',
      size_type: 'regular',
      custom_label_0: 'Science Lover',
      custom_label_3: 'Biology',
    },
    {
      id: 'var-tee-navy-l',
      item_group_id: 'grp-dna-tee',
      title: 'DNA Helix Science T-Shirt',
      description: 'Soft ringspun cotton biology shirt with double helix illustration.',
      link: 'https://shop.scienceofgifts.com/products/dna-helix-tee/?variant=2',
      image_link: 'https://cdn.example.com/dna-navy-l.jpg',
      availability: 'out of stock',
      price: '26.99 USD',
      google_product_category: 'Apparel & Accessories > Clothing > Shirts & Tops',
      product_type: 'Science Gifts > Biology Shirts',
      brand: 'Science of Gifts',
      identifier_exists: 'no',
      color: 'Navy',
      size: 'L',
      material: '100% Cotton',
      pattern: 'Graphic',
      gender: 'unisex',
      age_group: 'adult',
      condition: 'new',
      size_type: 'regular',
    },
    // Grouped by canonical URL alone (blank item_group_id, variant size differs)
    {
      id: 'var-mug-11oz',
      item_group_id: '',
      title: 'Caffeine Molecule Ceramic Mug',
      description: 'Glossy white ceramic mug with caffeine molecular diagram.',
      link: 'https://shop.scienceofgifts.com/products/caffeine-molecule-mug?size=11oz',
      image_link: 'https://cdn.example.com/mug-11.jpg',
      availability: 'in_stock',
      price: '16.00 USD',
      google_product_category: 'Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs',
      product_type: 'Science Gifts > Chemistry Mugs',
      brand: 'Science of Gifts',
      identifier_exists: 'no',
      color: 'White',
      size: '11 oz',
      material: 'Ceramic',
      condition: 'new',
    },
    {
      id: 'var-mug-15oz',
      item_group_id: '',
      title: 'Caffeine Molecule Ceramic Mug',
      description: 'Glossy white ceramic mug with caffeine molecular diagram.',
      link: 'https://shop.scienceofgifts.com/en-usd/products/caffeine-molecule-mug/',
      image_link: 'https://cdn.example.com/mug-15.jpg',
      availability: 'in_stock',
      price: '19.00 USD',
      google_product_category: 'Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs',
      product_type: 'Science Gifts > Chemistry Mugs',
      brand: 'Science of Gifts',
      identifier_exists: 'no',
      color: 'White',
      size: '15 oz',
      material: 'Ceramic',
      condition: 'new',
    },
    // Single-variant product (no item_group_id)
    {
      id: 'var-mat-1',
      item_group_id: '',
      title: 'Periodic Table Desk Mat',
      description: 'Large stitched-edge periodic table desk pad.',
      link: 'https://shop.scienceofgifts.com/products/periodic-table-desk-mat',
      image_link: 'https://cdn.example.com/mat.jpg',
      availability: 'in_stock',
      price: '29.50 USD',
      google_product_category: 'Office Supplies > Desk Pads & Blotters',
      product_type: 'Science Gifts > Desk Mats',
      brand: 'Science of Gifts',
      identifier_exists: 'no',
      condition: 'new',
    },
  ]);

  assert.equal(
    normalizeCanonicalProductUrl('https://www.scienceofgifts.fourthwall.com/en-usd/products/dna-helix-tee/?a=1#top'),
    'https://shop.scienceofgifts.com/products/dna-helix-tee'
  );

  const parsed = parseCsvText(csv);
  const grouped = groupCsvRowsToProducts(parsed);
  assert.equal(grouped.totalCsvRows, 5);
  assert.equal(grouped.groups.length, 3);
  assert.equal(grouped.totalVariants, 5);
  assert.equal(grouped.conflicts.length, 0);

  const products = convertParsedCsvToProducts(parsed);
  assert.equal(products.length, 3);

  const tee = products.find((p) => p.merchantData.item_group_id === 'grp-dna-tee');
  assert.ok(tee, 'DNA tee product should exist');
  assert.equal(tee.syncedVariants?.length, 2);
  assert.deepEqual(
    tee.syncedVariants?.map((v) => ({
      id: v.id,
      size: v.size,
      color: v.color,
      price: v.price,
      sale_price: v.sale_price,
      availability: v.availability,
      image_link: v.image_link,
      size_type: v.size_type,
    })),
    [
      {
        id: 'var-tee-black-s',
        size: 'S',
        color: 'Black',
        price: '24.99 USD',
        sale_price: '21.99 USD',
        availability: 'in_stock',
        image_link: 'https://cdn.example.com/dna-black-s.jpg',
        size_type: 'regular',
      },
      {
        id: 'var-tee-navy-l',
        size: 'L',
        color: 'Navy',
        price: '26.99 USD',
        sale_price: undefined,
        availability: 'out_of_stock',
        image_link: 'https://cdn.example.com/dna-navy-l.jpg',
        size_type: 'regular',
      },
    ]
  );

  const mug = products.find((p) => p.merchantData.title.includes('Caffeine Molecule'));
  assert.ok(mug, 'Caffeine mug product should exist');
  assert.equal(mug.syncedVariants?.length, 2);
  assert.ok(mug.merchantData.item_group_id, 'Multi-variant URL-grouped product gets deterministic item_group_id');
  assert.deepEqual(
    mug.syncedVariants?.map((v) => v.size),
    ['11 oz', '15 oz']
  );

  const mat = products.find((p) => p.merchantData.title.includes('Periodic Table'));
  assert.ok(mat, 'Desk mat product should exist');
  assert.equal(mat.syncedVariants?.length, 1);
  assert.equal(mat.syncedVariants?.[0].id, 'var-mat-1');
  assert.equal(mat.merchantData.item_group_id, '', 'Single-variant product must not get a synthetic item_group_id');
});

// 2. Strict idempotency on repeated imports
test('importing the same CSV twice or three times is strictly idempotent (zero growth in products or variants)', () => {
  const csv = buildCsv([
    {
      id: 'sku-a-s',
      item_group_id: 'grp-a',
      title: 'Quantum Physics Hoodie',
      description: 'Warm fleece hoodie for physics students.',
      link: 'https://shop.scienceofgifts.com/products/quantum-physics-hoodie',
      image_link: 'https://cdn.example.com/q-s.jpg',
      availability: 'in_stock',
      price: '44.00 USD',
      brand: 'Science of Gifts',
      color: 'Charcoal',
      size: 'S',
      condition: 'new',
    },
    {
      id: 'sku-a-m',
      item_group_id: 'grp-a',
      title: 'Quantum Physics Hoodie',
      description: 'Warm fleece hoodie for physics students.',
      link: 'https://shop.scienceofgifts.com/products/quantum-physics-hoodie',
      image_link: 'https://cdn.example.com/q-m.jpg',
      availability: 'in_stock',
      price: '44.00 USD',
      brand: 'Science of Gifts',
      color: 'Charcoal',
      size: 'M',
      condition: 'new',
    },
    // Exact duplicate variant row inside CSV itself should be deduplicated
    {
      id: 'sku-a-m',
      item_group_id: 'grp-a',
      title: 'Quantum Physics Hoodie',
      description: 'Warm fleece hoodie for physics students.',
      link: 'https://shop.scienceofgifts.com/products/quantum-physics-hoodie',
      image_link: 'https://cdn.example.com/q-m.jpg',
      availability: 'in_stock',
      price: '44.00 USD',
      brand: 'Science of Gifts',
      color: 'Charcoal',
      size: 'M',
      condition: 'new',
    },
    {
      id: 'sku-b-1',
      item_group_id: '',
      title: 'Astronomy Poster',
      description: 'Matte museum-grade astronomy poster.',
      link: 'https://shop.scienceofgifts.com/products/astronomy-poster',
      image_link: 'https://cdn.example.com/poster.jpg',
      availability: 'in_stock',
      price: '22.00 USD',
      brand: 'Science of Gifts',
      condition: 'new',
    },
  ]);

  const first = applyCsvCatalogImport([], csv, 'merge');
  assert.equal(first.summary.totalCsvRows, 4);
  assert.equal(first.summary.duplicateVariantRowsDeduplicated, 1);
  assert.equal(first.updatedCatalog.length, 2);
  assert.equal(first.summary.totalCatalogVariantsAfter, 3);

  const previewSecond = previewCsvCatalogImport(first.updatedCatalog, csv, 'merge');
  assert.equal(previewSecond.newProductsCount, 0);
  assert.equal(previewSecond.matchedExistingCount, 2);
  assert.equal(previewSecond.resultingProductCount, 2);
  assert.equal(previewSecond.resultingVariantCount, 3);
  assert.ok(previewSecond.matchedProducts.every((m) => !m.willModify));

  const second = applyCsvCatalogImport(first.updatedCatalog, csv, 'merge');
  assert.equal(second.updatedCatalog.length, 2);
  assert.equal(second.summary.newProductsAdded, 0);
  assert.equal(second.summary.matchedProductsModified, 0);
  assert.equal(second.summary.matchedProductsUnchanged, 2);
  assert.equal(second.summary.variantsAdded, 0);
  assert.equal(second.summary.totalCatalogVariantsAfter, 3);
  assert.deepEqual(second.updatedCatalog, first.updatedCatalog, 'Second merge must produce an identical catalog');

  const third = applyCsvCatalogImport(second.updatedCatalog, csv, 'update');
  assert.equal(third.updatedCatalog.length, 2);
  assert.equal(third.summary.matchedProductsModified, 0);
  assert.equal(third.summary.totalCatalogVariantsAfter, 3);
  assert.deepEqual(third.updatedCatalog, second.updatedCatalog, 'Repeated update must also be strictly idempotent');
});

// 3. Conflicting identities and ambiguous grouping preserved as separate products
test('preserves separate products when item_group_id and URL conflict or grouping is ambiguous, and stays idempotent', () => {
  const conflictCsv = buildCsv([
    // Same item_group_id across two DIFFERENT product URLs -> must split
    {
      id: 'v-split-1',
      item_group_id: 'shared-gid-conflict',
      title: 'Solar System Hoodie',
      description: 'Solar system hoodie.',
      link: 'https://shop.scienceofgifts.com/products/solar-system-hoodie',
      image_link: 'https://cdn.example.com/solar.jpg',
      availability: 'in_stock',
      price: '45.00 USD',
      size: 'M',
      condition: 'new',
    },
    {
      id: 'v-split-2',
      item_group_id: 'shared-gid-conflict',
      title: 'Galaxy Sweatshirt',
      description: 'Galaxy sweatshirt.',
      link: 'https://shop.scienceofgifts.com/products/galaxy-sweatshirt',
      image_link: 'https://cdn.example.com/galaxy.jpg',
      availability: 'in_stock',
      price: '42.00 USD',
      size: 'L',
      condition: 'new',
    },
    // Same URL across two DIFFERENT item_group_ids -> must stay separate
    {
      id: 'v-url-gid-a',
      item_group_id: 'gid-alpha',
      title: 'Lab Beaker Mug (Edition A)',
      description: 'Edition A mug.',
      link: 'https://shop.scienceofgifts.com/products/lab-beaker-mug',
      image_link: 'https://cdn.example.com/mug-a.jpg',
      availability: 'in_stock',
      price: '17.00 USD',
      color: 'White',
      condition: 'new',
    },
    {
      id: 'v-url-gid-b',
      item_group_id: 'gid-beta',
      title: 'Lab Beaker Mug (Edition B)',
      description: 'Edition B mug.',
      link: 'https://shop.scienceofgifts.com/products/lab-beaker-mug',
      image_link: 'https://cdn.example.com/mug-b.jpg',
      availability: 'in_stock',
      price: '18.00 USD',
      color: 'Black',
      condition: 'new',
    },
    // Generic non-product URL without item_group_id -> ambiguous, must stay separate
    {
      id: 'v-generic-1',
      item_group_id: '',
      title: 'Science Mystery Pin',
      description: 'Mystery pin.',
      link: 'https://shop.scienceofgifts.com/products',
      image_link: 'https://cdn.example.com/pin.jpg',
      availability: 'in_stock',
      price: '12.00 USD',
      condition: 'new',
    },
    {
      id: 'v-generic-2',
      item_group_id: '',
      title: 'Chemistry Sticker Pack',
      description: 'Sticker pack.',
      link: 'https://shop.scienceofgifts.com/products',
      image_link: 'https://cdn.example.com/stickers.jpg',
      availability: 'in_stock',
      price: '9.00 USD',
      condition: 'new',
    },
  ]);

  const first = applyCsvCatalogImport([], conflictCsv, 'merge');
  assert.equal(first.updatedCatalog.length, 6, 'All 6 conflicting/ambiguous rows must be preserved as separate products');
  assert.ok(first.preview.conflictsCount >= 3, 'All conflict types should be surfaced in preview');
  assert.ok(first.preview.conflicts.some((c) => c.type === 'item_group_id_url_conflict'));
  assert.ok(first.preview.conflicts.some((c) => c.type === 'url_item_group_id_conflict'));
  assert.ok(first.preview.conflicts.some((c) => c.type === 'ambiguous_url_grouping'));

  // Re-importing the exact same conflicting CSV must still be idempotent!
  const second = applyCsvCatalogImport(first.updatedCatalog, conflictCsv, 'merge');
  assert.equal(second.updatedCatalog.length, 6, 'Re-importing conflicting CSV must not create duplicate records');
  assert.equal(second.summary.newProductsAdded, 0);
  assert.equal(second.summary.totalCatalogVariantsAfter, 6);
});

// 4. Data preservation: manual edits, custom labels, optimization metadata, unmatched products, and non-blank protection
test('preserves existing manual edits, custom labels, optimization history, metadata, and unmatched products; blanks never overwrite populated fields', () => {
  const existingItem: ProductItem = {
    id: 'my-stable-custom-id',
    productGroup: 'Science & Education',
    productSubgroup: 'Chemistry',
    status: 'optimized',
    evidence: {
      sourceUrl: 'https://shop.scienceofgifts.com/products/periodic-coffee-mug',
      extractedAt: '2026-01-01T00:00:00.000Z',
      pageTitle: 'Periodic Table Coffee Mug',
      rawDescription: 'Original raw description',
      verifiedAttributes: { brand: 'Science of Gifts', material: 'Ceramic' },
      unresolvedAttributes: [],
      confidenceScores: { title: 1 },
      variants: [],
      images: ['https://cdn.example.com/original-mug.jpg'],
      userCorrections: {
        title: 'Hand-Tuned Periodic Table Coffee Mug — Chemistry Teacher Gift',
        color: 'Cobalt Blue',
      },
    },
    merchantData: {
      id: 'my-stable-custom-id',
      link: 'https://shop.scienceofgifts.com/products/periodic-coffee-mug',
      title: 'Hand-Tuned Periodic Table Coffee Mug — Chemistry Teacher Gift',
      description: 'Curated SEO description written manually by the store owner.',
      image_link: 'https://cdn.example.com/original-mug.jpg',
      additional_image_link: '',
      google_product_category: 'Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs',
      product_type: 'Science Gifts > Chemistry Mugs',
      price: '18.99 USD',
      sale_price: '',
      availability: 'in_stock',
      brand: 'Science of Gifts',
      gtin: '',
      mpn: '',
      identifier_exists: 'no',
      item_group_id: '',
      color: 'Cobalt Blue',
      size: '',
      material: 'Ceramic',
      pattern: '',
      gender: '',
      age_group: 'adult',
      condition: 'new',
      custom_label_0: 'Chemistry Teacher',
      custom_label_1: 'Best Seller',
      custom_label_2: 'Under $25',
      custom_label_3: 'Chemistry',
      custom_label_4: 'Evergreen',
    },
    giftIntelligence: {
      theme: 'Chemistry',
      subtheme: 'Periodic Table',
      targetAudience: ['Chemistry Teachers'],
      recipientPersonas: ['Lab Partner'],
      occasions: ['Graduation'],
      primaryGiftIntent: 'Teacher Appreciation',
      secondaryGiftIntents: ['Birthday'],
      searchConcepts: ['chemistry mug gift'],
    },
    titleCandidates: [
      {
        id: 'cand-1',
        title: 'Periodic Mug',
        formula: 'Gift Intent',
        scores: {
          coreThemeProminence: 95,
          giftSearchRelevance: 96,
          productClarity: 95,
          naturalLanguage: 94,
          factualAccuracy: 100,
          differentiation: 92,
          characterEfficiency: 96,
          total: 95,
        },
        reasoning: 'Strong hook',
      },
    ],
    strategy: {
      exactProductSummary: 'Ceramic periodic table coffee mug for chemistry lovers',
      dominantTheme: 'Chemistry',
      productCategory: 'Mug',
      verifiedPhysicalAttributes: ['Ceramic'],
      realisticBuyer: 'Student or colleague',
      realisticRecipient: 'Chemistry Teacher',
      giftRationale: 'High gift conversion.',
      relevantSearchIntents: ['chemistry teacher mug'],
      differentiatingAttributes: ['Periodic table print'],
      titleStrategy: 'Lead with Periodic Table Coffee Mug',
      descriptionStrategy: 'Highlight ceramic durability and chemistry teacher gift angle',
      productTypeStrategy: 'Science Gifts > Chemistry Mugs',
      customLabelsStrategy: {
        custom_label_0: 'Chemistry Teacher',
        custom_label_1: 'Best Seller',
        custom_label_2: 'Under $25',
        custom_label_3: 'Chemistry',
        custom_label_4: 'Evergreen',
      },
      antiRecommendations: [],
      googleCategoryRationale: 'Exact match for ceramic coffee mug',
      recommendedGoogleCategory: 'Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs',
      researchedAt: '2026-01-03T00:00:00.000Z',
    },
    audit: {
      overallScore: 96,
      fieldScores: {
        accuracy: 98,
        searchRelevance: 95,
        giftRelevance: 98,
        taxonomy: 100,
        description: 94,
        naturalLanguage: 95,
        compliance: 100,
      },
      issues: [],
      warnings: [],
      criticalErrors: [],
      suggestedFixes: [],
      auditedAt: '2026-01-03T00:00:00.000Z',
    },
    validation: { isValid: true, blockingErrors: [], warnings: [] },
    fieldProvenance: { title: 'USER_EDITED', color: 'USER_EDITED' },
    originalImported: { title: 'Periodic Table Coffee Mug' },
    appliedSuggestions: [{ timestamp: '2026-01-02T00:00:00.000Z', fields: ['title'], note: 'Manual edit' }],
    history: [
      { timestamp: '2026-01-02T00:00:00.000Z', note: 'Owner edit', snapshot: { title: 'Periodic Table Coffee Mug' } },
    ],
    websiteSyncMeta: {
      lastSyncedAt: '2026-01-04T00:00:00.000Z',
      feedUrl: 'https://shop.scienceofgifts.com/.well-known/merchant-center/rss.xml',
      websiteItemGroupId: 'grp-periodic-mug',
      canonicalProductUrl: 'https://shop.scienceofgifts.com/products/periodic-coffee-mug',
      matchMethod: 'canonical_url',
      variantCount: 1,
      preservedAppId: 'my-stable-custom-id',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-04T00:00:00.000Z',
  };

  const untouchedExistingItem: ProductItem = {
    ...existingItem,
    id: 'writer-shirt',
    merchantData: {
      ...existingItem.merchantData,
      id: 'writer-shirt',
      link: 'https://shop.scienceofgifts.com/products/writer-shirt',
      title: 'Preserved Writer Shirt',
    },
    websiteSyncMeta: undefined,
  };

  const incomingCsv = buildCsv([
    // Matches existingItem by canonical URL, has blank description/custom labels & different title/color
    {
      id: 'mug-var-11oz',
      item_group_id: 'grp-periodic-mug',
      title: 'Generic CSV Mug Title',
      description: '',
      link: 'https://shop.scienceofgifts.com/products/periodic-coffee-mug?variant=11oz',
      image_link: 'https://cdn.example.com/mug-11oz.jpg',
      availability: 'in_stock',
      price: '19.50 USD',
      brand: 'Science of Gifts',
      color: 'White',
      size: '11 oz',
      condition: 'new',
      custom_label_0: '',
      custom_label_1: '',
    },
    {
      id: 'mug-var-15oz',
      item_group_id: 'grp-periodic-mug',
      title: 'Generic CSV Mug Title',
      description: '',
      link: 'https://shop.scienceofgifts.com/products/periodic-coffee-mug?variant=15oz',
      image_link: 'https://cdn.example.com/mug-15oz.jpg',
      availability: 'in_stock',
      price: '22.50 USD',
      brand: 'Science of Gifts',
      color: 'White',
      size: '15 oz',
      condition: 'new',
    },
  ]);

  const snapshotBefore = JSON.stringify([existingItem, untouchedExistingItem]);

  // Preview must be strictly read-only
  const preview = previewCsvCatalogImport([existingItem, untouchedExistingItem], incomingCsv, 'merge');
  assert.equal(JSON.stringify([existingItem, untouchedExistingItem]), snapshotBefore, 'Preview must not mutate input catalog');
  assert.equal(preview.matchedExistingCount, 1);
  assert.equal(preview.newProductsCount, 0);
  assert.equal(preview.unmatchedExistingCount, 1);
  assert.equal(preview.resultingProductCount, 2);

  // Merge mode
  const merged = applyCsvCatalogImport([existingItem, untouchedExistingItem], incomingCsv, 'merge');
  assert.equal(merged.updatedCatalog.length, 2, 'Unmatched writer-shirt must be preserved');

  const updatedMug = merged.updatedCatalog.find((p) => p.id === 'my-stable-custom-id')!;
  assert.ok(updatedMug, 'Stable existing product ID must never be replaced');
  assert.equal(updatedMug.merchantData.title, existingItem.merchantData.title, 'Manual title must be preserved');
  assert.equal(updatedMug.merchantData.description, existingItem.merchantData.description, 'Populated description must never be overwritten with blank');
  assert.equal(updatedMug.merchantData.custom_label_0, 'Chemistry Teacher', 'Custom labels must be preserved');
  assert.equal(updatedMug.merchantData.custom_label_3, 'Chemistry');
  assert.equal(updatedMug.merchantData.color, 'Cobalt Blue', 'User-corrected color must be preserved');
  assert.equal(updatedMug.merchantData.price, '18.99 USD', 'Merge mode does not overwrite populated price');
  assert.equal(updatedMug.merchantData.size, '11 oz', 'Merge mode fills blank size from CSV');
  assert.equal(updatedMug.syncedVariants?.length, 2, 'All CSV variants stored in syncedVariants');
  assert.deepEqual(updatedMug.strategy, existingItem.strategy, 'AI strategy preserved');
  assert.deepEqual(updatedMug.audit, existingItem.audit, 'AI audit preserved');
  assert.deepEqual(updatedMug.titleCandidates, existingItem.titleCandidates, 'Title candidates preserved');
  assert.deepEqual(updatedMug.giftIntelligence, existingItem.giftIntelligence, 'Gift intelligence preserved');
  assert.deepEqual(updatedMug.appliedSuggestions, existingItem.appliedSuggestions, 'Applied suggestions preserved');
  assert.equal(updatedMug.productGroup, 'Science & Education');
  assert.ok(updatedMug.history.length >= existingItem.history.length, 'History preserved');
  assert.equal(updatedMug.websiteSyncMeta?.preservedAppId, 'my-stable-custom-id', 'websiteSyncMeta preserved');

  const preservedWriter = merged.updatedCatalog.find((p) => p.id === 'writer-shirt')!;
  assert.deepEqual(preservedWriter, untouchedExistingItem, 'Unmatched product must remain byte-for-byte identical');

  // Update mode refreshes non-blank commerce facts (like price) while STILL protecting manual title/description/labels/userCorrections
  const updated = applyCsvCatalogImport([existingItem, untouchedExistingItem], incomingCsv, 'update');
  const refreshedMug = updated.updatedCatalog.find((p) => p.id === 'my-stable-custom-id')!;
  assert.equal(refreshedMug.merchantData.price, '19.50 USD', 'Update mode refreshes non-blank price');
  assert.equal(refreshedMug.merchantData.title, existingItem.merchantData.title, 'Update mode still preserves custom title');
  assert.equal(refreshedMug.merchantData.description, existingItem.merchantData.description, 'Update mode never blanks description');
  assert.equal(refreshedMug.merchantData.color, 'Cobalt Blue', 'Update mode still respects userCorrections on color');
  assert.equal(refreshedMug.merchantData.custom_label_0, 'Chemistry Teacher', 'Update mode preserves custom labels');

  // Replace mode replaces entire catalog with grouped CSV items
  const replaced = applyCsvCatalogImport([existingItem, untouchedExistingItem], incomingCsv, 'replace');
  assert.equal(replaced.updatedCatalog.length, 1);
  assert.equal(replaced.updatedCatalog[0].syncedVariants?.length, 2);
});

// 5. CSV export round-trip compatibility
test('multi-variant imported catalog exports back to valid Merchant Center CSV & RSS rows and round-trips cleanly', () => {
  const sourceCsv = buildCsv([
    {
      id: 'rt-shirt-s',
      item_group_id: 'rt-grp-shirt',
      title: 'Astrophysics Star Chart T-Shirt',
      description: 'Soft cotton star chart t-shirt for astronomy enthusiasts and science lovers.',
      link: 'https://shop.scienceofgifts.com/products/astrophysics-star-chart-tee',
      image_link: 'https://cdn.example.com/star-s.jpg',
      availability: 'in_stock',
      price: '25.00 USD',
      google_product_category: 'Apparel & Accessories > Clothing > Shirts & Tops',
      product_type: 'Science Gifts > Astronomy Apparel',
      brand: 'Science of Gifts',
      identifier_exists: 'no',
      color: 'Black',
      size: 'S',
      material: 'Cotton',
      gender: 'unisex',
      age_group: 'adult',
      condition: 'new',
      size_type: 'regular',
      custom_label_0: 'Astronomy Fan',
      custom_label_3: 'Space & Astronomy',
    },
    {
      id: 'rt-shirt-xl',
      item_group_id: 'rt-grp-shirt',
      title: 'Astrophysics Star Chart T-Shirt',
      description: 'Soft cotton star chart t-shirt for astronomy enthusiasts and science lovers.',
      link: 'https://shop.scienceofgifts.com/products/astrophysics-star-chart-tee',
      image_link: 'https://cdn.example.com/star-xl.jpg',
      availability: 'out_of_stock',
      price: '28.00 USD',
      google_product_category: 'Apparel & Accessories > Clothing > Shirts & Tops',
      product_type: 'Science Gifts > Astronomy Apparel',
      brand: 'Science of Gifts',
      identifier_exists: 'no',
      color: 'Navy',
      size: 'XL',
      material: 'Cotton',
      gender: 'unisex',
      age_group: 'adult',
      condition: 'new',
      size_type: 'regular',
      custom_label_0: 'Astronomy Fan',
      custom_label_3: 'Space & Astronomy',
    },
    {
      id: 'rt-coaster-1',
      item_group_id: '',
      title: 'Molecular Structure Cork Coaster',
      description: 'Laser-etched cork coaster featuring classic chemistry molecular structures.',
      link: 'https://shop.scienceofgifts.com/products/molecular-cork-coaster',
      image_link: 'https://cdn.example.com/coaster.jpg',
      availability: 'in_stock',
      price: '14.00 USD',
      google_product_category: 'Home & Garden > Kitchen & Dining > Tableware > Coasters',
      product_type: 'Science Gifts > Home Decor',
      brand: 'Science of Gifts',
      identifier_exists: 'no',
      condition: 'new',
    },
  ]);

  const imported = applyCsvCatalogImport([], sourceCsv, 'merge');
  assert.equal(imported.updatedCatalog.length, 2);

  const exportValidation = validateExportedFeedRows(imported.updatedCatalog);
  assert.equal(exportValidation.isValid, true, `Export should pass validation: ${exportValidation.errors.join('; ')}`);
  assert.equal(exportValidation.totalCatalogDesigns, 2);
  assert.equal(exportValidation.totalExportedVariantRows, 3);

  const exportedRows = expandCatalogToExportRows(imported.updatedCatalog);
  assert.equal(exportedRows.length, 3);
  assert.deepEqual(
    exportedRows.map((r) => ({
      id: r.id,
      item_group_id: r.item_group_id,
      size: r.size,
      color: r.color,
      price: r.price,
      availability: r.availability,
    })),
    [
      {
        id: 'rt-shirt-s',
        item_group_id: 'rt-grp-shirt',
        size: 'S',
        color: 'Black',
        price: '25.00 USD',
        availability: 'in_stock',
      },
      {
        id: 'rt-shirt-xl',
        item_group_id: 'rt-grp-shirt',
        size: 'XL',
        color: 'Navy',
        price: '28.00 USD',
        availability: 'out_of_stock',
      },
      {
        id: 'rt-coaster-1',
        item_group_id: '',
        size: '',
        color: '',
        price: '14.00 USD',
        availability: 'in_stock',
      },
    ]
  );

  // Full CSV text -> re-parse -> re-import round-trip
  const exportedCsvText = generateMerchantCenterCsv(imported.updatedCatalog);
  const reImported = applyCsvCatalogImport(imported.updatedCatalog, exportedCsvText, 'merge');
  assert.equal(reImported.updatedCatalog.length, 2, 'Round-trip re-import must keep 2 products');
  assert.equal(reImported.summary.newProductsAdded, 0);
  assert.equal(reImported.summary.totalCatalogVariantsAfter, 3, 'Round-trip re-import must keep 3 variants');

  // Verify RSS XML export also stays compatible
  const rssXml = generateMerchantCenterRssXml(imported.updatedCatalog);
  assert.ok(rssXml.includes('<g:id>rt-shirt-s</g:id>'));
  assert.ok(rssXml.includes('<g:id>rt-shirt-xl</g:id>'));
  assert.ok(rssXml.includes('<g:id>rt-coaster-1</g:id>'));
});

// 6. Real production Merchant Center CSV fixture (science_of_gifts_merchant_feed_fixed.csv) idempotency & round-trip
test('real 642-row Merchant Center CSV groups cleanly, exports all 642 rows, and is 100% idempotent on repeated imports', () => {
  const realCsvPath = path.resolve(process.cwd(), 'science_of_gifts_merchant_feed_fixed.csv');
  if (!fs.existsSync(realCsvPath)) {
    console.log('    (skipped real CSV check: science_of_gifts_merchant_feed_fixed.csv not present)');
    return;
  }

  const realCsvText = fs.readFileSync(realCsvPath, 'utf-8');
  const first = applyCsvCatalogImport([], realCsvText, 'merge');
  assert.equal(first.summary.totalCsvRows, 642);
  assert.equal(first.summary.uniqueCsvProducts, 161);
  assert.equal(first.summary.totalCsvVariants, 642);
  assert.equal(first.summary.conflictsCount, 0);
  assert.equal(first.updatedCatalog.length, 161);
  assert.equal(first.summary.totalCatalogVariantsAfter, 642);

  // Second import of the exact same 642-row CSV must be strictly idempotent
  const second = applyCsvCatalogImport(first.updatedCatalog, realCsvText, 'merge');
  assert.equal(second.updatedCatalog.length, 161, 'Second import must still have exactly 161 products');
  assert.equal(second.summary.totalCatalogVariantsAfter, 642, 'Second import must still have exactly 642 variants');
  assert.equal(second.summary.newProductsAdded, 0);
  assert.equal(second.summary.matchedProductsModified, 0);
  assert.equal(second.summary.matchedProductsUnchanged, 161);
  assert.equal(second.summary.variantsAdded, 0);

  // Verify export back to CSV produces all 642 variant rows with 0 blocking errors
  const exportCheck = validateExportedFeedRows(second.updatedCatalog);
  assert.equal(exportCheck.totalCatalogDesigns, 161);
  assert.equal(exportCheck.totalExportedVariantRows, 642);
  assert.equal(exportCheck.isValid, true, `Real feed export validation failed: ${exportCheck.errors.join('; ')}`);

  // Also test importing the real 642-row CSV into the live catalog (in memory only — never writing to disk)
  const catalogPath = path.resolve(process.cwd(), 'data/catalog.json');
  if (fs.existsSync(catalogPath)) {
    const liveCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8')) as ProductItem[];
    const mergedOnce = applyCsvCatalogImport(liveCatalog, realCsvText, 'merge');
    const mergedTwice = applyCsvCatalogImport(mergedOnce.updatedCatalog, realCsvText, 'merge');
    assert.equal(
      mergedTwice.updatedCatalog.length,
      mergedOnce.updatedCatalog.length,
      'Merging real CSV into existing catalog twice must not increase product count'
    );
    assert.equal(
      mergedTwice.summary.totalCatalogVariantsAfter,
      mergedOnce.summary.totalCatalogVariantsAfter,
      'Merging real CSV into existing catalog twice must not increase variant count'
    );
    assert.equal(mergedTwice.summary.matchedProductsModified, 0);
    assert.equal(mergedTwice.summary.newProductsAdded, 0);
  }
});

// 7. Sanitization of dangerous URL protocols during CSV import
test('sanitizes dangerous non-HTTP URLs (e.g. javascript:) during CSV import', () => {
  const maliciousCsv = buildCsv([
    {
      id: 'sec-1',
      title: 'Test Product',
      description: 'Desc',
      link: 'javascript:alert(1)',
      image_link: 'data:text/html,<script>alert(1)</script>',
      availability: 'in_stock',
      price: '10.00 USD',
      condition: 'new',
    },
  ]);

  const result = applyCsvCatalogImport([], maliciousCsv, 'merge');
  assert.equal(result.updatedCatalog.length, 1);
  assert.equal(result.updatedCatalog[0].merchantData.link, '');
  assert.equal(result.updatedCatalog[0].merchantData.image_link, '');
  assert.equal(result.updatedCatalog[0].syncedVariants?.[0].link, '');
  assert.equal(result.updatedCatalog[0].syncedVariants?.[0].image_link, '');
});

if (process.exitCode && process.exitCode !== 0) {
  console.error('\nSome CSV import tests FAILED.');
} else {
  console.log('\nAll CSV import & catalog management tests PASSED.');
}

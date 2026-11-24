import assert from 'assert';
import { guessTaxonomy, inferProductGroupAndSubgroup as extractorInfer } from '../server/extractor';
import {
  fixSingleAuditIssue,
  createHeuristicStrategy,
  inferProductGroupAndSubgroup as strategistInfer,
  optimizeAndApplyAll,
} from '../server/aiStrategist';
import { allocateCustomLabels } from '../src/utils/customLabels';
import { INITIAL_STRATEGY_CONFIG } from '../src/utils/taxonomy';
import { ProductItem } from '../src/types/feed';

console.log('====================================================');
console.log('RUNNING TARGETED FIXES VERIFICATION TEST SUITE');
console.log('====================================================\n');

// 1. Check guessTaxonomy fallback
const unknownTaxonomy = guessTaxonomy('Abstract Item XYZ', 'An enigmatic item with no typical keywords.');
assert.strictEqual(unknownTaxonomy.gpc, '', 'guessTaxonomy returns empty gpc when keywords do not match');
assert.strictEqual(unknownTaxonomy.productType, '', 'guessTaxonomy returns empty productType when keywords do not match');
console.log('✓ [PASS] Fix 1a: guessTaxonomy returns empty strings when no category matches');

// 2. Check fixSingleAuditIssue taxonomy fallback
const dummyItem: ProductItem = {
  id: 'test_item',
  productGroup: 'Other',
  productSubgroup: 'General Gifts',
  status: 'not_analyzed',
  evidence: {
    sourceUrl: 'https://example.com/test',
    extractedAt: new Date().toISOString(),
    pageTitle: 'Test Product',
    rawDescription: 'Test Description',
    verifiedAttributes: {},
    unresolvedAttributes: [],
    confidenceScores: {},
    variants: [],
    images: [],
    userCorrections: {},
  },
  merchantData: {
    id: 'test_item',
    link: 'https://example.com/test',
    title: 'Test Product',
    description: 'Test Description',
    image_link: '',
    additional_image_link: '',
    google_product_category: '',
    product_type: '',
    price: '25.00 USD',
    availability: 'in_stock',
    brand: 'Science of Gifts',
    gtin: '',
    mpn: '',
    identifier_exists: 'no',
    item_group_id: '',
    color: '',
    size: '',
    material: '',
    gender: 'unisex',
    age_group: 'adult',
    condition: 'new',
    custom_label_0: '',
    custom_label_1: '',
    custom_label_2: '',
    custom_label_3: '',
    custom_label_4: '',
  },
  giftIntelligence: {
    theme: '',
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
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// Check createHeuristicStrategy productCat default
const heuristicStrategy = createHeuristicStrategy(dummyItem, INITIAL_STRATEGY_CONFIG);
assert.strictEqual(heuristicStrategy.productCategory, 'Uncategorized Gift Item', 'createHeuristicStrategy defaults to Uncategorized Gift Item');
assert.strictEqual(heuristicStrategy.recommendedGoogleCategory, '', 'createHeuristicStrategy does not fallback to Apparel when uncategorized');
console.log('✓ [PASS] Fix 1b: createHeuristicStrategy defaults productCategory to "Uncategorized Gift Item" with no apparel fallback');

// Check fixSingleAuditIssue does not set Apparel & Accessories > Clothing without recommendation
dummyItem.audit = {
  overallScore: 70,
  fieldScores: {
    accuracy: 70,
    searchRelevance: 70,
    giftRelevance: 70,
    taxonomy: 70,
    description: 70,
    naturalLanguage: 70,
    compliance: 70,
  },
  issues: [
    {
      id: 'issue_gpc',
      field: 'google_product_category',
      title: 'Missing GPC',
      description: 'Missing GPC description',
      state: 'safe_to_fix',
      suggestedFix: 'Set category',
    },
  ],
  warnings: [],
  criticalErrors: [],
  suggestedFixes: [],
  auditedAt: new Date().toISOString(),
};

async function run() {
  await fixSingleAuditIssue(dummyItem, 'issue_gpc', INITIAL_STRATEGY_CONFIG);
  assert.strictEqual(dummyItem.merchantData.google_product_category, '', 'fixSingleAuditIssue does not set Apparel fallback when no recommendation exists');
  console.log('✓ [PASS] Fix 1c: fixSingleAuditIssue does not fallback to Apparel & Accessories > Clothing');

  // Fix 2: Check optimizeAndApplyAll attribute preservation when fieldProvenance is VERIFIED or USER_EDITED
  const itemWithVerifiedAttributes: ProductItem = {
    ...dummyItem,
    fieldProvenance: {
      color: 'VERIFIED',
      size: 'USER_EDITED',
      material: 'VERIFIED',
    },
    merchantData: {
      ...dummyItem.merchantData,
      color: 'Emerald Green',
      size: '2XL',
      material: '100% Organic Linen',
    },
    suggestedMerchantData: {
      color: 'AI Hallucinated Black',
      size: 'One Size',
      material: 'Polyester',
    },
  };

  const res = await optimizeAndApplyAll(itemWithVerifiedAttributes, INITIAL_STRATEGY_CONFIG);
  const optProduct = res.product;
  assert.strictEqual(optProduct.merchantData.color, 'Emerald Green', 'Preserves VERIFIED color');
  assert.strictEqual(optProduct.merchantData.size, '2XL', 'Preserves USER_EDITED size');
  assert.strictEqual(optProduct.merchantData.material, '100% Organic Linen', 'Preserves VERIFIED material');
  console.log('✓ [PASS] Fix 2: optimizeAndApplyAll preserves VERIFIED and USER_EDITED attributes against AI overwrites');

  // Fix 3: Check Custom Label schema
  const labelAllocation = allocateCustomLabels(dummyItem, INITIAL_STRATEGY_CONFIG, {
    theme: 'Viking Lore',
    productType: 'T-Shirts',
  });
  assert.notStrictEqual(labelAllocation.custom_label_0, 'Viking Lore', 'custom_label_0 cannot be Theme');
  assert.notStrictEqual(labelAllocation.custom_label_3, labelAllocation.custom_label_1, 'custom_label_3 cannot be Price');
  assert.strictEqual(labelAllocation.custom_label_3, 'Viking Lore', 'custom_label_3 is Theme / Collection');
  console.log('✓ [PASS] Fix 3: Strict Custom Label schema strictly separates Audience (0), Price (1), Seasonality (2), Theme (3), Product Type (4)');

  // Fix 4: Domain inference checks
  const himymInferred = extractorInfer('How I Met Your Mother McLaren Pub Tee', 'History buff will love this sitcom shirt', 'https://example.com');
  assert.strictEqual(himymInferred.productGroup, 'TV & Film', 'HIMYM is never classified under generic History');

  const vikingInferred = extractorInfer('Norse Mythology Yggdrasil Shirt', 'Historical world tree design', 'https://example.com');
  assert.strictEqual(vikingInferred.productSubgroup, 'Vikings', 'Vikings/Norse is never classified under General History');
  assert.notStrictEqual(vikingInferred.productSubgroup, 'General History', 'Vikings is not General History');

  const popCultureInferred = extractorInfer('90s Sitcom Pop Culture Tee', 'The ultimate historical television series shirt', 'https://example.com');
  assert.strictEqual(popCultureInferred.productGroup, 'TV & Film', 'Aggressive filter prevents television/sitcom with "historical" from becoming History');
  console.log('✓ [PASS] Fix 4: inferProductGroupAndSubgroup prevents TV/Film and Vikings from misclassifying under generic History');

  console.log('\n====================================================');
  console.log('ALL TARGETED FIXES VERIFIED SUCCESSFULLY!');
  console.log('====================================================');
}

run();

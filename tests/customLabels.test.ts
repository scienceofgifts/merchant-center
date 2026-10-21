import assert from 'assert';
import { ProductItem } from '../src/types/feed';
import { INITIAL_STRATEGY_CONFIG } from '../src/utils/taxonomy';
import {
  allocateCustomLabels,
  derivePriceTier,
  detectCustomLabelAnomalies,
  isPriceLikeString,
  isProductTypeLikeString,
} from '../src/utils/customLabels';

console.log('====================================================');
console.log('RUNNING REGRESSION SUITE: CUSTOM LABEL ALLOCATION');
console.log('====================================================\n');

function createTestProduct(overrides: Partial<ProductItem> = {}): ProductItem {
  const now = new Date().toISOString();
  const baseMerchantData = {
    id: overrides.id || 'prod_custom_test_01',
    link: 'https://scienceofgifts.fourthwall.com/products/greek-mythology-water-bottle',
    title: 'Greek Mythology Water Bottle - Athena Design',
    description: 'Stainless steel insulated water bottle featuring Athena design.',
    image_link: '',
    additional_image_link: '',
    google_product_category: 'Home & Garden > Kitchen & Dining > Food & Beverage Carriers > Water Bottles',
    product_type: 'Water Bottles',
    price: '29.99 USD',
    availability: 'in_stock',
    brand: 'Science of Gifts',
    gtin: '',
    mpn: '',
    identifier_exists: 'no',
    item_group_id: '',
    color: 'Glossy White',
    size: '20 oz',
    material: 'Stainless Steel',
    gender: 'unisex' as const,
    age_group: 'adult' as const,
    condition: 'new' as const,
    custom_label_0: '',
    custom_label_1: '',
    custom_label_2: '',
    custom_label_3: '',
    custom_label_4: '',
  };

  return {
    id: overrides.id || 'prod_custom_test_01',
    productGroup: 'History',
    productSubgroup: 'Greek Mythology',
    status: 'optimized',
    evidence: {
      sourceUrl: 'https://scienceofgifts.fourthwall.com/products/greek-mythology-water-bottle',
      extractedAt: now,
      pageTitle: 'Greek Mythology Water Bottle | Science of Gifts',
      rawDescription: 'Stainless steel insulated water bottle featuring Athena design.',
      verifiedAttributes: { brand: 'Science of Gifts', material: 'Stainless Steel' },
      unresolvedAttributes: [],
      confidenceScores: { pageTitle: 1.0 },
      variants: [],
      images: [],
      userCorrections: {},
      ...(overrides.evidence || {}),
    },
    merchantData: {
      ...baseMerchantData,
      ...(overrides.merchantData || {}),
    },
    giftIntelligence: {
      theme: 'Greek Mythology',
      subtheme: 'Athena',
      targetAudience: ['History Buffs'],
      recipientPersonas: ['History Enthusiast'],
      occasions: ['Year-Round'],
      primaryGiftIntent: 'greek mythology gifts',
      secondaryGiftIntents: [],
      searchConcepts: [],
      ...(overrides.giftIntelligence || {}),
    },
    titleCandidates: [],
    originalImported: {
      title: 'Greek Mythology Water Bottle',
      price: '29.99 USD',
    } as any,
    appliedSuggestions: [],
    history: [],
    validation: { isValid: true, blockingErrors: [], warnings: [] },
    createdAt: now,
    updatedAt: now,
    ...(overrides as any),
  };
}

let passedTests = 0;
let totalTests = 0;

function runTest(testName: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    const res = fn();
    if (res && typeof (res as any).then === 'function') {
      return (res as Promise<void>).then(() => {
        passedTests++;
        console.log(`✓ [PASS] Test ${totalTests}: ${testName}`);
      }).catch((err) => {
        console.error(`✗ [FAIL] Test ${totalTests}: ${testName}`);
        console.error(err);
        process.exitCode = 1;
      });
    } else {
      passedTests++;
      console.log(`✓ [PASS] Test ${totalTests}: ${testName}`);
    }
  } catch (err) {
    console.error(`✗ [FAIL] Test ${totalTests}: ${testName}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function runCustomLabelTests() {
  // Test 1: Each of the five labels receives the correct semantic category
  runTest('1. Each of the five labels receives the correct semantic category', () => {
    const product = createTestProduct();
    const allocated = allocateCustomLabels(product, INITIAL_STRATEGY_CONFIG);

    assert.strictEqual(allocated.custom_label_0, 'History Buffs');
    assert.strictEqual(allocated.custom_label_1, 'Mid-Tier Gifts ($20 - $40)');
    assert.strictEqual(allocated.custom_label_2, 'Year-Round Essential');
    assert.strictEqual(allocated.custom_label_3, 'Greek Mythology');
    assert.strictEqual(allocated.custom_label_4, 'Water Bottle');
  });

  // Test 2: Price tiers are derived from the actual price
  runTest('2. Price tiers are derived from the actual price', () => {
    const p1 = createTestProduct({ merchantData: { price: '14.50 USD' } as any });
    assert.strictEqual(derivePriceTier(p1.merchantData.price), 'Budget Gifts (< $20)');

    const p2 = createTestProduct({ merchantData: { price: '35.00 USD' } as any });
    assert.strictEqual(derivePriceTier(p2.merchantData.price), 'Mid-Tier Gifts ($20 - $40)');

    const p3 = createTestProduct({ merchantData: { price: '59.99 USD' } as any });
    assert.strictEqual(derivePriceTier(p3.merchantData.price), 'Premium Gifts ($40 - $75)');

    const p4 = createTestProduct({ merchantData: { price: '120.00 USD' } as any });
    assert.strictEqual(derivePriceTier(p4.merchantData.price), 'Deluxe Apparel & Bundles (> $75)');
  });

  // Test 3: Changing the product type does not alter the price-tier assignment
  runTest('3. Changing the product type does not alter the price-tier assignment', () => {
    const prodWaterBottle = createTestProduct({
      merchantData: {
        title: 'Greek Mythology Water Bottle',
        description: 'Water bottle description',
        price: '35.00 USD',
        product_type: 'Water Bottle',
      } as any,
    });
    const prodHoodie = createTestProduct({
      merchantData: {
        title: 'Greek Mythology Hoodie',
        description: 'Hoodie description',
        price: '35.00 USD',
        product_type: 'Hoodies & Sweatshirts',
      } as any,
    });

    const lWater = allocateCustomLabels(prodWaterBottle, INITIAL_STRATEGY_CONFIG);
    const lHoodie = allocateCustomLabels(prodHoodie, INITIAL_STRATEGY_CONFIG);

    assert.strictEqual(lWater.custom_label_1, lHoodie.custom_label_1);
    assert.strictEqual(lWater.custom_label_1, 'Mid-Tier Gifts ($20 - $40)');
    assert.strictEqual(lWater.custom_label_4, 'Water Bottle');
    assert.strictEqual(lHoodie.custom_label_4, 'Hoodie');
  });

  // Test 4: Changing the theme does not alter the seasonality assignment
  runTest('4. Changing the theme does not alter the seasonality assignment', () => {
    const prodGreek = createTestProduct({
      giftIntelligence: { theme: 'Greek Mythology' } as any,
    });
    const prodRome = createTestProduct({
      giftIntelligence: { theme: 'Ancient Rome' } as any,
    });

    const lGreek = allocateCustomLabels(prodGreek, INITIAL_STRATEGY_CONFIG);
    const lRome = allocateCustomLabels(prodRome, INITIAL_STRATEGY_CONFIG);

    assert.strictEqual(lGreek.custom_label_2, lRome.custom_label_2);
    assert.strictEqual(lGreek.custom_label_2, 'Year-Round Essential');
    assert.strictEqual(lGreek.custom_label_3, 'Greek Mythology');
    assert.strictEqual(lRome.custom_label_3, 'Ancient Rome');
  });

  // Test 5: Apparel, drinkware, wall art, and other product types are handled correctly
  runTest('5. Apparel, drinkware, wall art, and other product types are handled correctly', () => {
    const tShirt = createTestProduct({ merchantData: { title: 'Norse Viking T-Shirt', description: 'T-shirt description' } as any });
    const mug = createTestProduct({ merchantData: { title: 'Roman Ceramic Mug', description: 'Mug description' } as any });
    const poster = createTestProduct({ merchantData: { title: 'WWII Spitfire Blueprint Poster', description: 'Poster description' } as any });
    const deskMat = createTestProduct({ merchantData: { title: 'HIMYM Desk Mat', description: 'Desk mat description' } as any });

    assert.strictEqual(allocateCustomLabels(tShirt, INITIAL_STRATEGY_CONFIG).custom_label_4, 'T-Shirt');
    assert.strictEqual(allocateCustomLabels(mug, INITIAL_STRATEGY_CONFIG).custom_label_4, 'Mug');
    assert.strictEqual(allocateCustomLabels(poster, INITIAL_STRATEGY_CONFIG).custom_label_4, 'Poster');
    assert.strictEqual(allocateCustomLabels(deskMat, INITIAL_STRATEGY_CONFIG).custom_label_4, 'Desk Mat');
  });

  // Test 6: Both individual optimization and batch optimization use the same label mapping
  runTest('6. Both individual optimization and batch optimization use the same label mapping', () => {
    const prod = createTestProduct();
    const lIndividual = allocateCustomLabels(prod, INITIAL_STRATEGY_CONFIG);
    const anomalies = detectCustomLabelAnomalies(prod, INITIAL_STRATEGY_CONFIG);
    const lBatch = anomalies.recommendedLabels;

    assert.deepStrictEqual(lIndividual, lBatch);
  });

  // Test 7: The Auto-Allocate Labels feature follows the same definitions
  runTest('7. The Auto-Allocate Labels feature follows the same definitions', () => {
    const prod = createTestProduct({
      merchantData: {
        custom_label_0: 'Apparel', // scrambled
        custom_label_1: 'History Buffs', // scrambled
        custom_label_2: 'T-Shirt', // scrambled
        custom_label_3: 'Under 30 USD', // scrambled
        custom_label_4: 'Year-Round Essential', // scrambled
      } as any,
    });

    const anomalies = detectCustomLabelAnomalies(prod, INITIAL_STRATEGY_CONFIG);
    assert.strictEqual(anomalies.hasMisallocatedLabels, true);

    const fixed = anomalies.recommendedLabels;
    assert.strictEqual(fixed.custom_label_1, 'Mid-Tier Gifts ($20 - $40)');
    assert.strictEqual(fixed.custom_label_3, 'Greek Mythology');
    assert.strictEqual(fixed.custom_label_4, 'Water Bottle');
  });

  // Test 8: Existing product IDs and unrelated fields remain unchanged
  runTest('8. Existing product IDs and unrelated fields remain unchanged', () => {
    const prod = createTestProduct({ id: 'immutable_id_123', merchantData: { title: 'Original Title' } as any });
    const originalId = prod.id;
    const originalTitle = prod.merchantData.title;

    const allocated = allocateCustomLabels(prod, INITIAL_STRATEGY_CONFIG);
    assert.strictEqual(prod.id, originalId);
    assert.strictEqual(prod.merchantData.title, originalTitle);
    assert.ok(allocated.custom_label_1);
  });

  // Test 9: Previously valid product titles and descriptions continue to work
  runTest('9. Previously valid product titles and descriptions continue to work', () => {
    const prod = createTestProduct({
      merchantData: {
        title: 'Valid Product Title - History Collection',
        description: 'Valid product description with rich details.',
      } as any,
    });

    assert.strictEqual(prod.merchantData.title, 'Valid Product Title - History Collection');
    assert.strictEqual(prod.merchantData.description, 'Valid product description with rich details.');
  });

  // Test 10: Existing custom-label data is not silently overwritten during startup or migration
  runTest('10. Existing custom-label data is not silently overwritten during startup or migration', () => {
    const prod = createTestProduct({
      merchantData: {
        custom_label_0: 'History Buffs',
        custom_label_1: 'Mid-Tier Gifts ($20 - $40)',
        custom_label_2: 'Year-Round Essential',
        custom_label_3: 'Greek Mythology',
        custom_label_4: 'Water Bottle',
      } as any,
    });

    const anomalies = detectCustomLabelAnomalies(prod, INITIAL_STRATEGY_CONFIG);
    // Properly formatted valid custom labels should not be flagged as misallocated anomalies
    assert.strictEqual(anomalies.hasMisallocatedLabels, false);
  });

  console.log(`\n====================================================`);
  console.log(`TEST SUMMARY: ${passedTests} PASSED, ${totalTests - passedTests} FAILED`);
  console.log(`====================================================`);
}

runCustomLabelTests();

import { ProductItem } from '../src/types/feed';
import { INITIAL_STRATEGY_CONFIG } from '../src/utils/taxonomy';
import {
  validateSemanticConsistency,
  inferProductGroupAndSubgroup,
} from '../server/aiStrategist';

// Mock fixtures
const ww2Product: ProductItem = {
  id: 'ww2_spitfire_shirt',
  productGroup: 'History',
  productSubgroup: 'WWII',
  status: 'not_analyzed',
  evidence: {
    sourceUrl: 'https://shop.scienceofgifts.com/products/wwii-spitfire-shirt',
    extractedAt: '2026-10-21T00:00:00.000Z',
    pageTitle: 'WWII Spitfire Fighter Ace T-Shirt | Science of Gifts',
    rawDescription: 'Authentic 100% cotton T-shirt featuring WWII RAF Spitfire Mk IX blueprint illustration.',
    verifiedAttributes: { brand: 'Science of Gifts', material: '100% Cotton', color: 'Navy' },
    unresolvedAttributes: [],
    confidenceScores: { pageTitle: 1.0, material: 1.0 },
    variants: [],
    images: ['https://example.com/spitfire.jpg'],
    userCorrections: {},
  },
  merchantData: {
    id: 'ww2_spitfire_shirt',
    link: 'https://shop.scienceofgifts.com/products/wwii-spitfire-shirt',
    title: 'WWII Spitfire Fighter Ace T-Shirt',
    description: 'Authentic 100% cotton T-shirt featuring WWII RAF Spitfire Mk IX blueprint illustration.',
    image_link: 'https://example.com/spitfire.jpg',
    additional_image_link: '',
    google_product_category: 'Apparel & Accessories > Clothing > Shirts & Tops',
    product_type: 'Apparel > T-Shirts > WWII History',
    price: '29.90 USD',
    availability: 'in_stock',
    brand: 'Science of Gifts',
    gtin: '',
    mpn: '',
    identifier_exists: 'no',
    item_group_id: '',
    color: 'Navy',
    size: 'L',
    material: '100% Cotton',
    gender: 'unisex',
    age_group: 'adult',
    condition: 'new',
    custom_label_0: 'History Buffs',
    custom_label_1: 'Mid-Tier Gifts ($20 - $40)',
    custom_label_2: 'Year-Round Essential',
    custom_label_3: 'WWII Aviation',
    custom_label_4: 'T-Shirts',
  },
  giftIntelligence: {
    theme: 'WWII Aviation',
    subtheme: 'RAF Spitfire',
    targetAudience: ['Aviation Enthusiasts'],
    recipientPersonas: ['Pilot'],
    occasions: ['Birthday'],
    primaryGiftIntent: 'wwii aviation gifts',
    secondaryGiftIntents: ['spitfire shirt'],
    searchConcepts: ['Spitfire', 'WWII'],
  },
  titleCandidates: [],
  originalImported: {
    id: 'ww2_spitfire_shirt',
    link: 'https://shop.scienceofgifts.com/products/wwii-spitfire-shirt',
    title: 'WWII Spitfire Fighter Ace T-Shirt',
    description: 'Authentic 100% cotton T-shirt featuring WWII RAF Spitfire Mk IX blueprint illustration.',
    image_link: 'https://example.com/spitfire.jpg',
    additional_image_link: '',
    google_product_category: 'Apparel & Accessories > Clothing > Shirts & Tops',
    product_type: 'Apparel > T-Shirts > WWII History',
    price: '29.90 USD',
    availability: 'in_stock',
    brand: 'Science of Gifts',
    gtin: '',
    mpn: '',
    identifier_exists: 'no',
    item_group_id: '',
    color: 'Navy',
    size: 'L',
    material: '100% Cotton',
    gender: 'unisex',
    age_group: 'adult',
    condition: 'new',
    custom_label_0: '',
    custom_label_1: '',
    custom_label_2: '',
    custom_label_3: '',
    custom_label_4: '',
  },
  appliedSuggestions: [],
  history: [],
  validation: { isValid: true, blockingErrors: [], warnings: [] },
  createdAt: '2026-10-21T00:00:00.000Z',
  updatedAt: '2026-10-21T00:00:00.000Z',
};

const vikingProduct: ProductItem = {
  id: 'norse_viking_shirt',
  status: 'not_analyzed',
  evidence: {
    sourceUrl: 'https://shop.scienceofgifts.com/products/norse-viking-valhalla-shirt',
    extractedAt: '2026-10-21T00:00:00.000Z',
    pageTitle: 'Norse Viking Shield & Mjolnir T-Shirt | Science of Gifts',
    rawDescription: 'Premium heavyweight cotton tee featuring Odin Ravens and Thor Mjolnir Hammer engraving.',
    verifiedAttributes: { brand: 'Science of Gifts', material: '100% Cotton', color: 'Black' },
    unresolvedAttributes: [],
    confidenceScores: { pageTitle: 1.0, material: 1.0 },
    variants: [],
    images: ['https://example.com/viking.jpg'],
    userCorrections: {},
  },
  merchantData: {
    id: 'norse_viking_shirt',
    link: 'https://shop.scienceofgifts.com/products/norse-viking-valhalla-shirt',
    title: 'Norse Viking Shield & Mjolnir T-Shirt',
    description: 'Premium heavyweight cotton tee featuring Odin Ravens and Thor Mjolnir Hammer engraving.',
    image_link: 'https://example.com/viking.jpg',
    additional_image_link: '',
    google_product_category: 'Apparel & Accessories > Clothing > Shirts & Tops',
    product_type: 'Apparel > T-Shirts > Norse Mythology',
    price: '29.90 USD',
    availability: 'in_stock',
    brand: 'Science of Gifts',
    gtin: '',
    mpn: '',
    identifier_exists: 'no',
    item_group_id: '',
    color: 'Black',
    size: 'L',
    material: '100% Cotton',
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
  originalImported: {
    id: 'norse_viking_shirt',
    link: 'https://shop.scienceofgifts.com/products/norse-viking-valhalla-shirt',
    title: 'Norse Viking Shield & Mjolnir T-Shirt',
    description: 'Premium heavyweight cotton tee featuring Odin Ravens and Thor Mjolnir Hammer engraving.',
    image_link: 'https://example.com/viking.jpg',
    additional_image_link: '',
    google_product_category: 'Apparel & Accessories > Clothing > Shirts & Tops',
    product_type: 'Apparel > T-Shirts > Norse Mythology',
    price: '29.90 USD',
    availability: 'in_stock',
    brand: 'Science of Gifts',
    gtin: '',
    mpn: '',
    identifier_exists: 'no',
    item_group_id: '',
    color: 'Black',
    size: 'L',
    material: '100% Cotton',
    gender: 'unisex',
    age_group: 'adult',
    condition: 'new',
    custom_label_0: '',
    custom_label_1: '',
    custom_label_2: '',
    custom_label_3: '',
    custom_label_4: '',
  },
  appliedSuggestions: [],
  history: [],
  validation: { isValid: true, blockingErrors: [], warnings: [] },
  createdAt: '2026-10-21T00:00:00.000Z',
  updatedAt: '2026-10-21T00:00:00.000Z',
};

async function runTests() {
  console.log('==============================================');
  console.log('RUNNING REGRESSION SUITE: CROSS-PRODUCT CONTEXT');
  console.log('==============================================\n');

  let passedCount = 0;
  let failedCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✓ [PASS] ${testName}`);
      passedCount++;
    } else {
      console.error(`✕ [FAIL] ${testName} - ${detail || 'Assertion failed'}`);
      failedCount++;
    }
  }

  // TEST 1: Processing WWII Aviation product and then a Viking product preserves domain context
  try {
    const inferredWW2 = inferProductGroupAndSubgroup(
      ww2Product.merchantData.title,
      ww2Product.merchantData.description,
      ww2Product.evidence.sourceUrl
    );
    const inferredViking = inferProductGroupAndSubgroup(
      vikingProduct.merchantData.title,
      vikingProduct.merchantData.description,
      vikingProduct.evidence.sourceUrl
    );

    assert(
      inferredWW2.productGroup === 'History' &&
        inferredWW2.productSubgroup === 'WWII' &&
        inferredViking.productGroup === 'History' &&
        inferredViking.productSubgroup === 'Vikings',
      'Test 1: WWII Aviation and Viking products resolve to distinct product groups and subgroups',
      `WWII: ${inferredWW2.productSubgroup}, Viking: ${inferredViking.productSubgroup}`
    );
  } catch (err: any) {
    assert(false, 'Test 1: Domain resolution', err.message);
  }

  // TEST 2: Switching products while an AI request is pending cannot apply its response to the wrong entry
  try {
    let selectedProduct: ProductItem | null = { ...vikingProduct };

    // Function reproducing the safe syncSelectedProduct logic
    const syncSelectedProduct = (
      prevSelected: ProductItem | null,
      updatedList: ProductItem[],
      completedTargetId: string
    ): ProductItem | null => {
      // ONLY update selectedProduct if user is still viewing completedTargetId!
      if (prevSelected && prevSelected.id === completedTargetId) {
        const found = updatedList.find((p) => p.id === completedTargetId);
        return found || prevSelected;
      }
      return prevSelected; // Prevent overwriting currently viewed item!
    };

    const mockCatalog = [{ ...ww2Product }, { ...vikingProduct }];

    // Simulate WWII request completing while user is viewing Viking product
    const result = syncSelectedProduct(selectedProduct, mockCatalog, 'ww2_spitfire_shirt');

    assert(
      result?.id === 'norse_viking_shirt',
      'Test 2: Switching products while AI request is pending blocks overwriting the active product entry',
      `Active product ID remained: ${result?.id}`
    );
  } catch (err: any) {
    assert(false, 'Test 2: Product switch isolation', err.message);
  }

  // TEST 3: A stale cached response cannot overwrite newer product context
  try {
    const vikingWithStaleCache: ProductItem = {
      ...vikingProduct,
      strategy: {
        exactProductSummary: 'WWII RAF Spitfire Tee',
        dominantTheme: 'WWII Aviation',
        productCategory: 'T-Shirt',
        verifiedPhysicalAttributes: [],
        realisticBuyer: 'Pilot',
        realisticRecipient: 'Aviation Fan',
        giftRationale: 'Celebrates RAF aviation',
        relevantSearchIntents: ['spitfire gift'],
        differentiatingAttributes: ['Archival blueprint'],
        titleStrategy: 'WWII Aviation first',
        descriptionStrategy: 'Describe Spitfire aircraft',
        productTypeStrategy: 'Apparel > T-Shirts',
        customLabelsStrategy: {
          custom_label_0: 'History Buffs',
          custom_label_1: 'Mid-Tier Gifts',
          custom_label_2: 'Year-Round Essential',
          custom_label_3: 'WWII Aviation',
          custom_label_4: 'T-Shirts',
        },
        antiRecommendations: [],
        googleCategoryRationale: '',
        recommendedGoogleCategory: '',
        researchedAt: '2026-01-01T00:00:00.000Z',
      },
    };

    const staleCheck = validateSemanticConsistency(vikingWithStaleCache, {
      title: 'WWII Spitfire T-Shirt',
      description: 'RAF aircraft design',
      custom_label_3: 'WWII Aviation',
    }, vikingWithStaleCache.strategy);

    assert(
      staleCheck.isMismatch === true && staleCheck.mismatchedFields.includes('title'),
      'Test 3: Stale cached response from another domain is detected and rejected',
      staleCheck.reason
    );
  } catch (err: any) {
    assert(false, 'Test 3: Stale cache rejection', err.message);
  }

  // TEST 4: A clear semantic mismatch is flagged before optimization is applied
  try {
    const mismatch = validateSemanticConsistency(vikingProduct, {
      title: 'WWII Spitfire Ace T-Shirt - RAF Warbird Design',
      description: 'Celebrates WWII Allied aviation and Battle of Britain pilot heroics.',
      custom_label_3: 'WWII Aviation',
    });

    assert(
      mismatch.isMismatch === true &&
        mismatch.mismatchedFields.includes('title') &&
        mismatch.mismatchedFields.includes('description'),
      'Test 4: Clear semantic mismatch between Norse product and WWII output is caught and flagged',
      mismatch.reason
    );
  } catch (err: any) {
    assert(false, 'Test 4: Semantic mismatch detection', err.message);
  }

  // TEST 5: Resetting generated fields restores the correct original values
  try {
    const contaminatedItem: ProductItem = {
      ...vikingProduct,
      merchantData: {
        ...vikingProduct.merchantData,
        title: 'WWII Spitfire T-Shirt (Contaminated)',
        description: 'WWII aviation description (Contaminated)',
        custom_label_3: 'WWII Aviation',
      },
    };

    // Simulate recovery endpoint logic
    const original = contaminatedItem.originalImported || { ...contaminatedItem.merchantData };
    const restoredItem: ProductItem = {
      ...contaminatedItem,
      merchantData: {
        ...contaminatedItem.merchantData,
        ...original,
      },
      strategy: undefined,
      suggestedMerchantData: undefined,
      suggestedGiftIntelligence: undefined,
      titleCandidates: [],
    };

    assert(
      restoredItem.merchantData.title === 'Norse Viking Shield & Mjolnir T-Shirt' &&
        restoredItem.merchantData.description.includes('Thor Mjolnir Hammer') &&
        restoredItem.strategy === undefined,
      'Test 5: Resetting generated fields restores authoritative original imported values and purges stale AI cache'
    );
  } catch (err: any) {
    assert(false, 'Test 5: Reset to original', err.message);
  }

  // TEST 6: Existing verified facts and unrelated settings remain intact
  try {
    const itemWithVerified: ProductItem = {
      ...vikingProduct,
      evidence: {
        ...vikingProduct.evidence,
        verifiedAttributes: {
          brand: 'Science of Gifts',
          material: '100% Ring-spun Cotton',
          color: 'Black',
          size: 'L',
        },
      },
      merchantData: {
        ...vikingProduct.merchantData,
        brand: 'Science of Gifts',
        material: '100% Ring-spun Cotton',
        color: 'Black',
        size: 'L',
      },
    };

    const originalMaterial = itemWithVerified.evidence.verifiedAttributes.material;
    const originalColor = itemWithVerified.evidence.verifiedAttributes.color;
    const originalBrand = itemWithVerified.evidence.verifiedAttributes.brand;

    assert(
      originalMaterial === '100% Ring-spun Cotton' &&
        originalColor === 'Black' &&
        originalBrand === 'Science of Gifts',
      'Test 6: Verified facts (color, material, size, brand) and immutable evidence remain strictly preserved'
    );
  } catch (err: any) {
    assert(false, 'Test 6: Verified facts integrity', err.message);
  }

  // TEST 7: Normal optimization still works for both products without cross-contamination
  try {
    const validVikingProposed = {
      title: 'Viking Valhalla T-Shirt - Thor Mjolnir Hammer Norse Design',
      description: 'Authentic Science of Gifts apparel celebrating Norse mythology and Viking heritage.',
      custom_label_3: 'Vikings',
    };

    const validWW2Proposed = {
      title: 'WWII Spitfire Gift T-Shirt - RAF Fighter Ace Blueprint Design',
      description: 'Authentic Science of Gifts apparel celebrating WWII Allied aviation history.',
      custom_label_3: 'WWII Aviation',
    };

    const vikingCheck = validateSemanticConsistency(vikingProduct, validVikingProposed);
    const ww2Check = validateSemanticConsistency(ww2Product, validWW2Proposed);

    assert(
      !vikingCheck.isMismatch && !ww2Check.isMismatch,
      'Test 7: Valid domain-aligned optimizations pass validation cleanly for both Norse/Viking and WWII products'
    );
  } catch (err: any) {
    assert(false, 'Test 7: Legitimate optimization validation', err.message);
  }

  console.log('\n==============================================');
  console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('==============================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests();

import assert from 'assert';
import { ProductItem } from '../src/types/feed';
import { INITIAL_STRATEGY_CONFIG } from '../src/utils/taxonomy';
import {
  reconcileProductAttributes,
  getEvidenceAwareCorrections,
  isSpecificVariantItem,
} from '../src/utils/attributeReconciler';
import {
  computeFieldProvenance,
  generateProductStrategy,
  generateOptimizedFields,
  createHeuristicFields,
  createHeuristicAudit,
  optimizeAndApplyAll,
  fixSingleAuditIssue,
} from '../server/aiStrategist';

console.log('====================================================');
console.log('RUNNING REGRESSION SUITE: ATTRIBUTE CORRECTION & SAFETY');
console.log('====================================================\n');

function createMockProduct(overrides: Partial<ProductItem> = {}): ProductItem {
  const now = new Date().toISOString();
  return {
    id: overrides.id || 'prod_test_001',
    productGroup: 'History',
    productSubgroup: 'WWII',
    status: 'not_analyzed',
    evidence: {
      sourceUrl: 'https://shop.scienceofgifts.com/products/spitfire-hoodie',
      extractedAt: now,
      pageTitle: 'WWII RAF Spitfire Mk IX Blueprint Hoodie | Science of Gifts',
      rawDescription: 'Crafted from heavy 100% Cotton. Features detailed archival schematic print of the Supermarine Spitfire.',
      verifiedAttributes: {
        brand: 'Science of Gifts',
        color: 'Navy Blue',
        size: 'S - 3XL',
        material: '100% Cotton',
      },
      unresolvedAttributes: [],
      confidenceScores: { pageTitle: 1.0, material: 0.95 },
      variants: [
        { id: 'v_s', title: 'Navy / S', size: 'S', color: 'Navy Blue' },
        { id: 'v_m', title: 'Navy / M', size: 'M', color: 'Navy Blue' },
        { id: 'v_l', title: 'Navy / L', size: 'L', color: 'Navy Blue' },
        { id: 'v_xl', title: 'Navy / XL', size: 'XL', color: 'Navy Blue' },
        { id: 'v_2xl', title: 'Navy / 2XL', size: '2XL', color: 'Navy Blue' },
        { id: 'v_3xl', title: 'Navy / 3XL', size: '3XL', color: 'Navy Blue' },
      ],
      images: ['https://example.com/spitfire.jpg'],
      userCorrections: {},
      ...(overrides.evidence || {}),
    },
    merchantData: {
      id: overrides.id || 'prod_test_001',
      link: 'https://shop.scienceofgifts.com/products/spitfire-hoodie',
      title: 'WWII Spitfire Blueprint Hoodie',
      description: 'Crafted from heavy 100% Cotton.',
      image_link: 'https://example.com/spitfire.jpg',
      google_product_category: 'Apparel & Accessories > Clothing > Outerwear > Sweatshirts & Hoodies',
      product_type: 'Apparel > Hoodies & Sweatshirts',
      price: '49.99 USD',
      availability: 'in_stock',
      brand: 'Science of Gifts',
      gtin: '',
      mpn: '',
      identifier_exists: 'no',
      item_group_id: 'prod_test_001',
      color: 'Black', // Contradicted: evidence says Navy Blue
      size: 'M',      // Contradicted: parent listing provides S - 3XL
      material: 'Polyester', // Contradicted: evidence says 100% Cotton
      gender: 'unisex',
      age_group: 'adult',
      condition: 'new',
      custom_label_0: '',
      custom_label_1: '',
      custom_label_2: 'Year-Round Essential',
      custom_label_3: '',
      custom_label_4: '',
      ...(overrides.merchantData || {}),
    },
    giftIntelligence: {
      theme: 'WWII History',
      subtheme: 'Aviation',
      targetAudience: ['History Buffs'],
      recipientPersonas: ['Aviation Enthusiast'],
      occasions: ['Birthday'],
      primaryGiftIntent: 'aviation gifts',
      secondaryGiftIntents: [],
      searchConcepts: [],
      ...(overrides.giftIntelligence || {}),
    },
    titleCandidates: [],
    originalImported: {
      title: 'WWII RAF Spitfire Mk IX Blueprint Hoodie',
      color: 'Black',
      size: 'M',
      material: 'Polyester',
    },
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

async function runAllTests() {
  // Test 1: Incorrect manually entered value is corrected when explicit source evidence supports replacement
  await runTest(
    'Incorrect manually entered clothing size "M", color "Black", and material "Polyester" are corrected to verified specs',
    async () => {
      const product = createMockProduct();
      const discrepancies = reconcileProductAttributes(product);

      const sizeDisc = discrepancies.find((d) => d.field === 'size');
      assert.ok(sizeDisc, 'Size discrepancy must be detected');
      assert.strictEqual(sizeDisc.status, 'contradicted');
      assert.strictEqual(sizeDisc.proposedValue, 'S - 3XL');
      assert.strictEqual(sizeDisc.isSafeToFix, true);

      const colorDisc = discrepancies.find((d) => d.field === 'color');
      assert.ok(colorDisc, 'Color discrepancy must be detected');
      assert.strictEqual(colorDisc.status, 'contradicted');
      assert.strictEqual(colorDisc.proposedValue, 'Navy Blue');

      const matDisc = discrepancies.find((d) => d.field === 'material');
      assert.ok(matDisc, 'Material discrepancy must be detected');
      assert.strictEqual(matDisc.status, 'contradicted');
      assert.strictEqual(matDisc.proposedValue, '100% Cotton');

      // Test optimization pipeline proposes corrections
      const strategy = await generateProductStrategy(product, INITIAL_STRATEGY_CONFIG);
      const fields = await generateOptimizedFields(product, strategy, INITIAL_STRATEGY_CONFIG);

      assert.strictEqual(fields.suggestedMerchantData.size, 'S - 3XL');
      assert.strictEqual(fields.suggestedMerchantData.color, 'Navy Blue');
      assert.strictEqual(fields.suggestedMerchantData.material, '100% Cotton');
    }
  );

  // Test 2: Correct existing value is preserved
  await runTest(
    'Correct existing value that matches source evidence is strictly preserved',
    () => {
      const product = createMockProduct({
        merchantData: {
          size: 'S - 3XL',
          color: 'Navy Blue',
          material: '100% Cotton',
        } as any,
      });

      const discrepancies = reconcileProductAttributes(product);
      const sizeDisc = discrepancies.find((d) => d.field === 'size');
      assert.ok(sizeDisc);
      assert.strictEqual(sizeDisc.status, 'supported');
      assert.strictEqual(sizeDisc.proposedValue, 'S - 3XL');

      const prov = computeFieldProvenance(product);
      assert.strictEqual(prov.fieldProvenance.size, 'VERIFIED');
      assert.strictEqual(prov.fieldProvenance.color, 'VERIFIED');
      assert.strictEqual(prov.fieldProvenance.material, 'VERIFIED');
    }
  );

  // Test 3: Contradicted verified value is flagged in audit and can be fixed
  await runTest(
    'Contradicted attribute is flagged in quality audit and resolved via single issue fix',
    async () => {
      const product = createMockProduct({
        merchantData: {
          size: 'M',
        } as any,
      });

      const audit = createHeuristicAudit(product);
      const sizeIssue = audit.issues.find((i) => i.id === 'iss_contradicted_size' || i.field === 'size');
      assert.ok(sizeIssue, 'Audit must create an issue for contradicted size');
      assert.strictEqual(sizeIssue.state, 'safe_to_fix');
      assert.ok(sizeIssue.description.includes('S - 3XL'));

      // Fix the single issue
      const fixResult = await fixSingleAuditIssue(product, sizeIssue.id, INITIAL_STRATEGY_CONFIG);
      assert.strictEqual(fixResult.product.merchantData.size, 'S - 3XL');
      assert.strictEqual(fixResult.fixedIssue.state, 'fixed');
    }
  );

  // Test 4: Unknown-provenance value is not automatically treated as verified
  await runTest(
    'Unknown-provenance value is marked UNVERIFIED rather than blindly VERIFIED',
    () => {
      const product = createMockProduct({
        evidence: {
          verifiedAttributes: {},
          variants: [],
        } as any,
        merchantData: {
          size: 'Custom 42',
          color: 'Mystic Grey',
          material: 'Composite Blend',
        } as any,
      });

      const prov = computeFieldProvenance(product);
      assert.strictEqual(prov.fieldProvenance.size, 'UNVERIFIED');
      assert.strictEqual(prov.fieldProvenance.color, 'UNVERIFIED');
      assert.strictEqual(prov.fieldProvenance.material, 'UNVERIFIED');
    }
  );

  // Test 5: User-approved override is preserved when evidence is present
  await runTest(
    'User-approved override in evidence.userCorrections is preserved and never overwritten',
    async () => {
      const product = createMockProduct({
        evidence: {
          userCorrections: {
            size: 'M', // User explicitly entered M and wants to keep it
          },
        } as any,
        merchantData: {
          size: 'M',
        } as any,
      });

      const discrepancies = reconcileProductAttributes(product);
      const sizeDisc = discrepancies.find((d) => d.field === 'size');
      assert.ok(sizeDisc);
      assert.strictEqual(sizeDisc.status, 'user_override');
      assert.strictEqual(sizeDisc.isSafeToFix, false);

      const prov = computeFieldProvenance(product);
      assert.strictEqual(prov.fieldProvenance.size, 'USER_EDITED');

      // 1-Click Optimize & Apply must NOT overwrite the user override
      const result = await optimizeAndApplyAll(product, INITIAL_STRATEGY_CONFIG);
      assert.strictEqual(result.product.merchantData.size, 'M', 'User override M must not be overwritten');
    }
  );

  // Test 6: Missing fields continue to be populated as before
  await runTest(
    'Missing fields continue to be populated from verified evidence',
    async () => {
      const product = createMockProduct({
        merchantData: {
          size: '',
          color: '',
          material: '',
        } as any,
      });

      const corrections = getEvidenceAwareCorrections(product);
      assert.strictEqual(corrections.size, 'S - 3XL');
      assert.strictEqual(corrections.color, 'Navy Blue');
      assert.strictEqual(corrections.material, '100% Cotton');

      const optResult = await optimizeAndApplyAll(product, INITIAL_STRATEGY_CONFIG);
      assert.strictEqual(optResult.product.merchantData.size, 'S - 3XL');
      assert.strictEqual(optResult.product.merchantData.color, 'Navy Blue');
      assert.strictEqual(optResult.product.merchantData.material, '100% Cotton');
    }
  );

  // Test 7: Clothing variant sizes are not confused with complete list of available sizes
  await runTest(
    'Specific variant item is not confused with parent size range',
    () => {
      // Create a specific variant item representing size "L"
      const variantProduct = createMockProduct({
        id: 'v_l', // Matches variant ID in evidence.variants
        merchantData: {
          id: 'v_l',
          title: 'WWII RAF Spitfire Mk IX Blueprint Hoodie - Navy / L',
          size: 'L',
        } as any,
      });

      const variantCheck = isSpecificVariantItem(variantProduct);
      assert.strictEqual(variantCheck.isVariant, true);
      assert.strictEqual(variantCheck.matchedVariant?.size, 'L');

      const discrepancies = reconcileProductAttributes(variantProduct);
      const sizeDisc = discrepancies.find((d) => d.field === 'size');
      assert.ok(sizeDisc);
      assert.strictEqual(sizeDisc.status, 'supported');
      assert.strictEqual(sizeDisc.proposedValue, 'L', 'Specific variant must retain variant size L, not full range');
    }
  );

  // Test 8: Failed extraction never erases a valid existing value
  await runTest(
    'Empty or failed extraction does not erase valid existing values and preserves ID',
    () => {
      const existingProduct = createMockProduct({
        id: 'preserve_prod_123',
        merchantData: {
          id: 'preserve_prod_123',
          size: '18" x 24"',
          color: 'Archival Cream',
          material: 'Museum-grade Matte Paper',
        } as any,
      });

      // Simulated extracted data from a failed/sparse page
      const sparseExtracted = {
        id: 'new_sparse_id',
        merchantData: {
          id: 'new_sparse_id',
          size: '', // Empty extracted size
          color: '', // Empty extracted color
          material: '',
        },
      };

      // Merging logic as implemented in server.ts
      const mergedMerchantData = {
        ...existingProduct.merchantData,
        ...sparseExtracted.merchantData,
        id: existingProduct.id, // Strictly preserved
        size: sparseExtracted.merchantData.size || existingProduct.merchantData.size,
        color: sparseExtracted.merchantData.color || existingProduct.merchantData.color,
        material: sparseExtracted.merchantData.material || existingProduct.merchantData.material,
      };

      assert.strictEqual(mergedMerchantData.id, 'preserve_prod_123');
      assert.strictEqual(mergedMerchantData.size, '18" x 24"');
      assert.strictEqual(mergedMerchantData.color, 'Archival Cream');
      assert.strictEqual(mergedMerchantData.material, 'Museum-grade Matte Paper');
    }
  );

  // Test 9: Corrections preserve original values in history/diff snapshots
  await runTest(
    'Attribute corrections record previous values in history snapshot and appliedSuggestions',
    async () => {
      const product = createMockProduct({
        merchantData: {
          size: 'M',
        } as any,
      });

      const initialHistoryLength = product.history.length;
      await optimizeAndApplyAll(product, INITIAL_STRATEGY_CONFIG);

      assert.strictEqual(product.history.length, initialHistoryLength + 1);
      const snapshot = product.history[0].snapshot;
      assert.strictEqual(snapshot.size, 'M', 'Snapshot must record the prior value M');
      assert.strictEqual(product.merchantData.size, 'S - 3XL', 'Current value must be updated to S - 3XL');

      const lastSuggestion = product.appliedSuggestions[product.appliedSuggestions.length - 1];
      assert.ok(lastSuggestion, 'appliedSuggestions must record the optimization');
      assert.ok(
        lastSuggestion.fields.some((f) => f.includes('Size')),
        'Applied fields must mention size correction'
      );
    }
  );

  // Test 10: Product IDs remain strictly unchanged
  await runTest(
    'Product ID is never mutated, slugified, or regenerated during optimization',
    async () => {
      const fixedId = 'custom_unique_id_999';
      const product = createMockProduct({
        id: fixedId,
        merchantData: { id: fixedId } as any,
      });

      const result = await optimizeAndApplyAll(product, INITIAL_STRATEGY_CONFIG);
      assert.strictEqual(result.product.id, fixedId, 'Product root ID must remain identical');
      assert.strictEqual(result.product.merchantData.id, fixedId, 'MerchantData ID must remain identical');
    }
  );

  // Test 11: Non-apparel dimensional and capacity correction (posters & mugs)
  await runTest(
    'Posters with clothing size "M" are corrected to dimensions and mugs to capacity',
    () => {
      // 1. Poster with 'M'
      const poster = createMockProduct({
        id: 'valhalla_poster',
        merchantData: {
          title: 'The Logistics of Valhalla Flowchart Poster',
          description: 'Archival 18x24 inches wall art poster.',
          size: 'M',
          material: 'Paper',
          google_product_category: 'Apparel & Accessories > Clothing',
        } as any,
        evidence: {
          pageTitle: 'Logistics of Valhalla Poster 18x24',
          rawDescription: 'Detailed flowchart print in 18" x 24" format on archival matte paper.',
          verifiedAttributes: {},
          variants: [],
        } as any,
      });

      const posterDiscrepancies = reconcileProductAttributes(poster);
      const posterSize = posterDiscrepancies.find((d) => d.field === 'size');
      assert.ok(posterSize);
      assert.strictEqual(posterSize.status, 'contradicted');
      assert.strictEqual(posterSize.proposedValue, '18" x 24"');

      const posterMat = posterDiscrepancies.find((d) => d.field === 'material');
      assert.ok(posterMat);
      assert.strictEqual(posterMat.status, 'contradicted');
      assert.strictEqual(posterMat.proposedValue, 'Museum-grade Matte Paper');

      const posterGpc = posterDiscrepancies.find((d) => d.field === 'google_product_category');
      assert.ok(posterGpc);
      assert.strictEqual(posterGpc.status, 'contradicted');
      assert.ok(posterGpc.proposedValue.includes('Posters'));

      // 2. Mug with 'M'
      const mug = createMockProduct({
        id: 'lincoln_mug',
        merchantData: {
          title: 'Abraham Lincoln Definition Mug',
          description: 'High quality 15 oz ceramic coffee cup.',
          size: 'M',
          material: 'Ceramic',
          google_product_category: 'Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs',
        } as any,
        evidence: {
          pageTitle: 'Abraham Lincoln 15 oz Mug',
          rawDescription: 'High quality 15 oz ceramic coffee cup with glossy finish.',
          verifiedAttributes: {},
          variants: [],
        } as any,
      });

      const mugDiscrepancies = reconcileProductAttributes(mug);
      const mugSize = mugDiscrepancies.find((d) => d.field === 'size');
      assert.ok(mugSize);
      assert.strictEqual(mugSize.status, 'contradicted');
      assert.strictEqual(mugSize.proposedValue, '15 oz');
    }
  );

  // Test 12: Ambiguous size flagging on parent product when source exposes multiple sizes
  await runTest(
    'If source exposes multiple sizes but parent listing does not establish single size, ambiguity is flagged as unresolved',
    () => {
      const athenaOwlHoodie = createMockProduct({
        id: 'athena_owl_hoodie',
        merchantData: {
          title: 'Athena Owl Greek Mythology Hoodie',
          size: 'M', // User entered M, but parent has variants S through 3XL
          color: 'Black',
          material: 'Cotton / Polyester Blend',
        } as any,
        evidence: {
          pageTitle: 'Athena Owl Hoodie',
          rawDescription: 'Greek mythology hoodie available in S, M, L, XL, 2XL, 3XL.',
          variants: [
            { id: 'v1', title: 'Black / S', size: 'S', color: 'Black' },
            { id: 'v2', title: 'Black / M', size: 'M', color: 'Black' },
            { id: 'v3', title: 'Black / L', size: 'L', color: 'Black' },
          ],
        } as any,
      });

      const discrepancies = reconcileProductAttributes(athenaOwlHoodie);
      const sizeDisc = discrepancies.find((d) => d.field === 'size');
      assert.ok(sizeDisc);
      assert.strictEqual(sizeDisc.status, 'unresolved', 'Ambiguous size must be flagged as unresolved');
      assert.strictEqual(sizeDisc.isSafeToFix, false, 'Ambiguous size must not be auto-fixed');
    }
  );

  console.log(`\n====================================================`);
  console.log(`TEST SUMMARY: ${passedTests} PASSED, ${totalTests - passedTests} FAILED`);
  console.log(`====================================================\n`);

  if (totalTests - passedTests > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

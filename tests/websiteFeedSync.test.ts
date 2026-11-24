import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  APPROVED_WEBSITE_FEED_URL,
  isPrivateOrReservedIp,
  validateFeedUrlAndResolveIp,
  fetchWebsiteFeedXml,
  parseMerchantCenterRssXml,
  groupFeedVariantsByDesign,
  previewWebsiteFeedSync,
  applyWebsiteFeedSync,
} from '../server/websiteFeedSync';
import {
  atomicWriteJson,
  createCatalogBackup,
  listCatalogBackups,
} from '../server/storage';
import {
  selectAllUnmatchedDesigns,
  selectMatchedWithNewVariants,
  clearUnmatchedDesignSelection,
  toggleUnmatchedDesignSelection,
  computeUnmatchedSelectionReview,
} from '../src/utils/feedSyncSelection';
import {
  expandCatalogToExportRows,
  generateMerchantCenterCsv,
  generateMerchantCenterRssXml,
  validateExportedFeedRows,
  parseCsvText,
  applyCsvCatalogImport,
  isValidGtin,
  isGenuineMpn,
  determineProductIdentifiers,
} from '../src/utils/csv';
import { ProductItem } from '../src/types/feed';

const MOCK_PUBLIC_DNS = async (_hostname: string) => [
  { address: '104.21.55.12', family: 4 },
];

const SAMPLE_RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <g:title><![CDATA[Science of Gifts]]></g:title>
    <g:link>https://shop.scienceofgifts.com</g:link>
    <g:description><![CDATA[Science of Gifts]]></g:description>

    <!-- Multi-variant Clothing Product (5 sizes: S, M, L, XL, 2XL) -->
    <item>
      <g:id>uuid-tee-s</g:id>
      <g:item_group_id>group-uuid-maclarens-tee</g:item_group_id>
      <g:title><![CDATA[MacLaren's Pub T-Shirt]]></g:title>
      <g:description><![CDATA[Raw storefront description for MacLaren's Pub T-shirt.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/maclarens-pub-t-shirt</g:link>
      <g:image_link>https://img.example.com/maclarens-s.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:quantity>9999</g:quantity>
      <g:price>26.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:mpn>MPN-TEE-S</g:mpn>
      <g:color>Black</g:color>
      <g:size>S</g:size>
      <g:age_group>adult</g:age_group>
      <g:gender>unisex</g:gender>
      <g:condition>new</g:condition>
    </item>
    <item>
      <g:id>uuid-tee-m</g:id>
      <g:item_group_id>group-uuid-maclarens-tee</g:item_group_id>
      <g:title><![CDATA[MacLaren's Pub T-Shirt]]></g:title>
      <g:description><![CDATA[Raw storefront description for MacLaren's Pub T-shirt.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/maclarens-pub-t-shirt</g:link>
      <g:image_link>https://img.example.com/maclarens-m.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:quantity>9999</g:quantity>
      <g:price>26.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:mpn>MPN-TEE-M</g:mpn>
      <g:color>Black</g:color>
      <g:size>M</g:size>
      <g:age_group>adult</g:age_group>
      <g:gender>unisex</g:gender>
      <g:condition>new</g:condition>
    </item>
    <item>
      <g:id>uuid-tee-l</g:id>
      <g:item_group_id>group-uuid-maclarens-tee</g:item_group_id>
      <g:title><![CDATA[MacLaren's Pub T-Shirt]]></g:title>
      <g:description><![CDATA[Raw storefront description for MacLaren's Pub T-shirt.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/maclarens-pub-t-shirt</g:link>
      <g:image_link>https://img.example.com/maclarens-l.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:quantity>9999</g:quantity>
      <g:price>26.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:mpn>MPN-TEE-L</g:mpn>
      <g:color>Black</g:color>
      <g:size>L</g:size>
      <g:age_group>adult</g:age_group>
      <g:gender>unisex</g:gender>
      <g:condition>new</g:condition>
    </item>
    <item>
      <g:id>uuid-tee-xl</g:id>
      <g:item_group_id>group-uuid-maclarens-tee</g:item_group_id>
      <g:title><![CDATA[MacLaren's Pub T-Shirt]]></g:title>
      <g:description><![CDATA[Raw storefront description for MacLaren's Pub T-shirt.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/maclarens-pub-t-shirt</g:link>
      <g:image_link>https://img.example.com/maclarens-xl.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:quantity>9999</g:quantity>
      <g:price>26.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:mpn>MPN-TEE-XL</g:mpn>
      <g:color>Black</g:color>
      <g:size>XL</g:size>
      <g:age_group>adult</g:age_group>
      <g:gender>unisex</g:gender>
      <g:condition>new</g:condition>
    </item>
    <item>
      <g:id>uuid-tee-2xl</g:id>
      <g:item_group_id>group-uuid-maclarens-tee</g:item_group_id>
      <g:title><![CDATA[MacLaren's Pub T-Shirt]]></g:title>
      <g:description><![CDATA[Raw storefront description for MacLaren's Pub T-shirt.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/maclarens-pub-t-shirt</g:link>
      <g:image_link>https://img.example.com/maclarens-2xl.jpg</g:image_link>
      <g:availability>out of stock</g:availability>
      <g:quantity>0</g:quantity>
      <g:price>28.50 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:mpn>MPN-TEE-2XL</g:mpn>
      <g:color>Black</g:color>
      <g:size>2XL</g:size>
      <g:age_group>adult</g:age_group>
      <g:gender>unisex</g:gender>
      <g:condition>new</g:condition>
    </item>

    <!-- Non-Clothing Size Variants: Mug (11 oz & 15 oz) -->
    <item>
      <g:id>uuid-mug-11oz</g:id>
      <g:item_group_id>group-uuid-gettysburg-mug</g:item_group_id>
      <g:title><![CDATA[Gettysburg 1863 Coffee Mug]]></g:title>
      <g:description><![CDATA[Storefront mug description.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/gettysburg-1863-coffee-mug</g:link>
      <g:image_link>https://img.example.com/mug-11.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>16.99 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:mpn>MPN-MUG-11</g:mpn>
      <g:color>White</g:color>
      <g:size>11 oz</g:size>
      <g:condition>new</g:condition>
    </item>
    <item>
      <g:id>uuid-mug-15oz</g:id>
      <g:item_group_id>group-uuid-gettysburg-mug</g:item_group_id>
      <g:title><![CDATA[Gettysburg 1863 Coffee Mug]]></g:title>
      <g:description><![CDATA[Storefront mug description.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/gettysburg-1863-coffee-mug</g:link>
      <g:image_link>https://img.example.com/mug-15.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>19.99 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:mpn>MPN-MUG-15</g:mpn>
      <g:color>White</g:color>
      <g:size>15 oz</g:size>
      <g:condition>new</g:condition>
    </item>

    <!-- Non-Clothing Size Variants: Poster (12x18 & 18x24) -->
    <item>
      <g:id>uuid-poster-12x18</g:id>
      <g:item_group_id>group-uuid-spitfire-poster</g:item_group_id>
      <g:title><![CDATA[Spitfire Blueprint Poster]]></g:title>
      <g:description><![CDATA[Storefront poster description.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/spitfire-mk-ix-blueprint-poster</g:link>
      <g:image_link>https://img.example.com/poster-12x18.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>22.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:mpn>MPN-POSTER-1218</g:mpn>
      <g:color>Navy</g:color>
      <g:size>12" x 18"</g:size>
      <g:condition>new</g:condition>
    </item>
    <item>
      <g:id>uuid-poster-18x24</g:id>
      <g:item_group_id>group-uuid-spitfire-poster</g:item_group_id>
      <g:title><![CDATA[Spitfire Blueprint Poster]]></g:title>
      <g:description><![CDATA[Storefront poster description.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/spitfire-mk-ix-blueprint-poster</g:link>
      <g:image_link>https://img.example.com/poster-18x24.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>28.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:mpn>MPN-POSTER-1824</g:mpn>
      <g:color>Navy</g:color>
      <g:size>18" x 24"</g:size>
      <g:condition>new</g:condition>
    </item>

    <!-- Single-Variant Product (No g:item_group_id) -->
    <item>
      <g:id>uuid-desk-mat-single</g:id>
      <g:title><![CDATA[How I Met Your Mother Desk Mat]]></g:title>
      <g:description><![CDATA[Raw storefront desk mat description.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/how-i-met-your-mother-desk-mat</g:link>
      <g:image_link>https://img.example.com/desk-mat.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>19.90 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:mpn>MPN-DESKMAT-01</g:mpn>
      <g:color>Multicolor</g:color>
      <g:size>15.5 x 31.5 inches</g:size>
      <g:condition>new</g:condition>
    </item>

    <!-- Title-Only Similarity Item (Different URL & IDs — must be flagged as ambiguous, never auto-matched) -->
    <item>
      <g:id>uuid-ambiguous-title-only</g:id>
      <g:title><![CDATA[Viking Norse Mythology Gift Hoodie - Yggdrasil Fleece]]></g:title>
      <g:description><![CDATA[Different URL product with identical title.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/completely-different-viking-hoodie-v2</g:link>
      <g:image_link>https://img.example.com/viking-v2.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>54.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:mpn>MPN-VIKING-V2</g:mpn>
      <g:size>L</g:size>
      <g:condition>new</g:condition>
    </item>

    <!-- Unmatched Website Feed Item -->
    <item>
      <g:id>uuid-unmatched-new-backpack</g:id>
      <g:title><![CDATA[Brand New Dinosaur Backpack]]></g:title>
      <g:description><![CDATA[Brand new backpack not yet in catalog.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/brand-new-dinosaur-backpack</g:link>
      <g:image_link>https://img.example.com/dino-backpack.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>59.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:mpn>MPN-DINO-BP</g:mpn>
      <g:size>One size</g:size>
      <g:condition>new</g:condition>
    </item>
  </channel>
</rss>`;

function createSampleCatalogProduct(overrides: {
  id: string;
  link: string;
  title: string;
  description: string;
  price?: string;
  size?: string;
  color?: string;
  mpn?: string;
  item_group_id?: string;
  custom_label_0?: string;
  custom_label_3?: string;
  custom_label_4?: string;
}): ProductItem {
  const now = '2026-10-20T00:00:00.000Z';
  return {
    id: overrides.id,
    status: 'optimized',
    evidence: {
      sourceUrl: overrides.link,
      extractedAt: now,
      pageTitle: overrides.title,
      rawDescription: overrides.description,
      verifiedAttributes: {
        brand: 'Science of Gifts',
        mpn: overrides.mpn,
      },
      unresolvedAttributes: [],
      confidenceScores: { title: 1, price: 1 },
      variants: [],
      images: ['https://img.example.com/default.jpg'],
      userCorrections: {},
    },
    merchantData: {
      id: overrides.id,
      link: overrides.link,
      title: overrides.title,
      description: overrides.description,
      image_link: 'https://img.example.com/default.jpg',
      google_product_category: 'Apparel & Accessories > Clothing > Shirts & Tops',
      product_type: 'Apparel > T-Shirts',
      price: overrides.price || '24.00 USD',
      availability: 'in_stock',
      brand: 'Science of Gifts',
      gtin: '',
      mpn: overrides.mpn || '',
      identifier_exists: 'no',
      item_group_id: overrides.item_group_id || '',
      color: overrides.color || 'Black',
      size: overrides.size || 'L',
      material: '100% Cotton',
      gender: 'unisex',
      age_group: 'adult',
      condition: 'new',
      custom_label_0: overrides.custom_label_0 || 'Sitcom Fans',
      custom_label_1: '$20 - $40',
      custom_label_2: 'Year-Round Essential',
      custom_label_3: overrides.custom_label_3 || 'How I Met Your Mother',
      custom_label_4: overrides.custom_label_4 || 'T-Shirts',
    },
    giftIntelligence: {
      theme: overrides.custom_label_3 || 'How I Met Your Mother',
      subtheme: '',
      targetAudience: [overrides.custom_label_0 || 'Sitcom Fans'],
      recipientPersonas: [],
      occasions: [],
      primaryGiftIntent: 'sitcom gift',
      secondaryGiftIntents: [],
      searchConcepts: [],
    },
    titleCandidates: [],
    appliedSuggestions: [],
    history: [],
    validation: { isValid: true, blockingErrors: [], warnings: [] },
    createdAt: now,
    updatedAt: now,
  };
}

async function runTests() {
  console.log('Running Website Feed Sync automated tests...');

  // 1. Parse valid RSS feed and group clothing + non-clothing + single-variant designs
  const parsedVariants = parseMerchantCenterRssXml(SAMPLE_RSS_FIXTURE);
  assert.strictEqual(parsedVariants.length, 12, 'Should parse all 12 <item> nodes from RSS fixture');

  const groups = groupFeedVariantsByDesign(parsedVariants);
  assert.strictEqual(groups.length, 6, 'Should group 12 variant items into 6 distinct product designs');

  // 2. Verify clothing size variants (S, M, L, XL, 2XL) grouped under 1 design
  const teeGroup = groups.find((g) => g.itemGroupId === 'group-uuid-maclarens-tee');
  assert.ok(teeGroup, 'Clothing group should exist');
  assert.strictEqual(teeGroup.variants.length, 5, 'Clothing group should have 5 size variants');
  assert.deepStrictEqual(
    teeGroup.variants.map((v) => v.size),
    ['S', 'M', 'L', 'XL', '2XL'],
    'Should preserve exact clothing sizes S, M, L, XL, 2XL'
  );

  // 3. Verify non-clothing size variants (mug 11 oz & 15 oz, poster 12" x 18" & 18" x 24")
  const mugGroup = groups.find((g) => g.itemGroupId === 'group-uuid-gettysburg-mug');
  assert.ok(mugGroup, 'Mug group should exist');
  assert.strictEqual(mugGroup.variants.length, 2, 'Mug group should have 2 capacity variants');
  assert.deepStrictEqual(
    mugGroup.variants.map((v) => v.size),
    ['11 oz', '15 oz'],
    'Should preserve exact mug oz sizes'
  );

  const posterGroup = groups.find((g) => g.itemGroupId === 'group-uuid-spitfire-poster');
  assert.ok(posterGroup, 'Poster group should exist');
  assert.strictEqual(posterGroup.variants.length, 2, 'Poster group should have 2 dimension variants');
  assert.deepStrictEqual(
    posterGroup.variants.map((v) => v.size),
    ['12" x 18"', '18" x 24"'],
    'Should preserve exact poster dimensions'
  );

  // 4. Verify single-variant product has 1 variant and no fabricated variants
  const deskMatGroup = groups.find((g) => g.primaryVariantId === 'uuid-desk-mat-single');
  assert.ok(deskMatGroup, 'Single-variant desk mat group should exist');
  assert.strictEqual(deskMatGroup.variants.length, 1, 'Single-variant design must have exactly 1 variant');

  // 5-9. Build catalog fixture and test read-only preview, matching methods, custom field preservation, and ambiguity detection
  const initialCatalog: ProductItem[] = [
    // Matched by canonical_url
    createSampleCatalogProduct({
      id: 'maclarens-pub-t-shirt',
      link: 'https://shop.scienceofgifts.com/products/maclarens-pub-t-shirt',
      title: "How I Met Your Mother Gift Tee - Custom Optimized MacLaren's Pub Shirt",
      description: 'Custom AI-optimized description for MacLaren Pub Shirt with deep fan references.',
      price: '24.00 USD',
    }),
    // Matched by mpn_sku
    createSampleCatalogProduct({
      id: 'sog_gettysburg_1863_mug',
      link: 'https://shop.scienceofgifts.com/products/legacy-url-gettysburg-mug',
      title: 'Battle of Gettysburg 1863 Gift Mug - Custom Optimized Ceramic Title',
      description: 'Custom AI-optimized description for Gettysburg 1863 Mug.',
      mpn: 'MPN-MUG-15',
    }),
    // Matched by item_group_id
    createSampleCatalogProduct({
      id: 'sog_spitfire_blueprint_poster',
      link: 'https://shop.scienceofgifts.com/products/legacy-spitfire-url',
      title: 'WWII RAF Spitfire Mk IX Blueprint Poster - Custom Optimized Aviation Gift',
      description: 'Custom AI-optimized description for Spitfire Blueprint Poster.',
      item_group_id: 'group-uuid-spitfire-poster',
    }),
    // Single-variant product matched by canonical_url
    createSampleCatalogProduct({
      id: 'how-i-met-your-mother-desk-mat',
      link: 'https://shop.scienceofgifts.com/products/how-i-met-your-mother-desk-mat',
      title: "How I Met Your Mother Gift Desk Mat - Custom Optimized MacLaren's Desk Pad",
      description: 'Custom AI-optimized description for HIMYM Desk Mat.',
      price: '19.90 USD',
      size: '15.5 x 31.5 inches',
    }),
    // Product with same title as uuid-ambiguous-title-only but different URL/ID -> must NOT auto-match!
    createSampleCatalogProduct({
      id: 'viking-norse-mythology-hoodie',
      link: 'https://shop.scienceofgifts.com/products/viking-norse-mythology-hoodie',
      title: 'Viking Norse Mythology Gift Hoodie - Yggdrasil Fleece',
      description: 'Custom AI-optimized description for Viking Hoodie.',
    }),
    // Unmatched catalog product
    createSampleCatalogProduct({
      id: 'writer-shirt',
      link: 'https://shop.scienceofgifts.com/en-usd/products/future-oscar-winner',
      title: 'Screenwriter Gift T-Shirt - Future Oscar Winner Tee',
      description: 'Custom AI-optimized description for Screenwriter Tee.',
    }),
  ];

  const snapshotBeforePreview = JSON.stringify(initialCatalog);
  const preview = previewWebsiteFeedSync(initialCatalog, parsedVariants);
  const snapshotAfterPreview = JSON.stringify(initialCatalog);

  // 9. Ensure preview mode does not mutate stored catalog state
  assert.strictEqual(
    snapshotBeforePreview,
    snapshotAfterPreview,
    'Preview mode must be strictly read-only and never mutate catalog state'
  );

  assert.strictEqual(preview.matchedProducts.length, 4, 'Should match 4 catalog products via strong identifiers');
  assert.strictEqual(preview.unmatchedFeedGroups.length, 1, 'Should report 1 unmatched website feed group (dinosaur backpack)');
  assert.strictEqual(preview.ambiguousMatches.length, 1, 'Should flag title-only similarity item as ambiguous');
  assert.strictEqual(
    preview.ambiguousMatches[0].websiteGroupKey,
    'url:https://shop.scienceofgifts.com/products/completely-different-viking-hoodie-v2',
    'Title-only match must be placed in ambiguousMatches'
  );
  // Both viking-norse-mythology-hoodie (not auto-matched) and writer-shirt should be in unmatchedCatalogItems
  assert.strictEqual(preview.unmatchedCatalogItems.length, 2, 'Should report 2 unmatched catalog items');

  // Verify strong match methods
  const matchedTee = preview.matchedProducts.find((m) => m.catalogProductId === 'maclarens-pub-t-shirt');
  const matchedMug = preview.matchedProducts.find((m) => m.catalogProductId === 'sog_gettysburg_1863_mug');
  const matchedPoster = preview.matchedProducts.find((m) => m.catalogProductId === 'sog_spitfire_blueprint_poster');
  assert.strictEqual(matchedTee?.matchMethod, 'canonical_url');
  assert.strictEqual(matchedMug?.matchMethod, 'mpn_sku');
  assert.strictEqual(matchedPoster?.matchMethod, 'item_group_id');

  // 6 & 7. Apply sync (in optional sync_factual mode) and verify custom titles/descriptions/labels are preserved while variants/prices/sizes update
  const { updatedCatalog, result: applyResult1 } = applyWebsiteFeedSync(
    initialCatalog,
    parsedVariants,
    APPROVED_WEBSITE_FEED_URL,
    { syncMode: 'sync_factual' }
  );
  assert.strictEqual(applyResult1.updatedProductCount, 4, 'Should update 4 matched catalog records');
  assert.strictEqual(applyResult1.totalVariantsSynced, 10, 'Should sync 5 + 2 + 2 + 1 = 10 total variants');

  const syncedTee = updatedCatalog.find((p) => p.id === 'maclarens-pub-t-shirt')!;
  assert.strictEqual(
    syncedTee.merchantData.title,
    "How I Met Your Mother Gift Tee - Custom Optimized MacLaren's Pub Shirt",
    'Must preserve custom optimized title after sync'
  );
  assert.strictEqual(
    syncedTee.merchantData.description,
    'Custom AI-optimized description for MacLaren Pub Shirt with deep fan references.',
    'Must preserve custom optimized description after sync'
  );
  assert.strictEqual(
    syncedTee.merchantData.custom_label_0,
    'Sitcom Fans',
    'Must preserve custom labels after sync'
  );
  assert.strictEqual(syncedTee.syncedVariants?.length, 5, 'Should store 5 synced clothing variants');
  assert.strictEqual(
    syncedTee.merchantData.item_group_id,
    'group-uuid-maclarens-tee',
    'Multi-variant product should have shared item_group_id'
  );
  assert.strictEqual(
    syncedTee.merchantData.price,
    '26.00 USD',
    'Should update base price from website feed when sync_factual mode is enabled'
  );

  const syncedDeskMat = updatedCatalog.find((p) => p.id === 'how-i-met-your-mother-desk-mat')!;
  assert.strictEqual(syncedDeskMat.syncedVariants?.length, 1, 'Single-variant product has 1 synced variant');
  assert.strictEqual(
    syncedDeskMat.merchantData.item_group_id,
    '',
    'Single-variant product must keep item_group_id empty'
  );

  // 10. Repeated sync with the same feed is idempotent
  const { updatedCatalog: secondCatalog, result: applyResult2 } = applyWebsiteFeedSync(
    updatedCatalog,
    parsedVariants,
    APPROVED_WEBSITE_FEED_URL,
    { syncMode: 'sync_factual' }
  );
  assert.strictEqual(
    applyResult2.updatedProductCount,
    0,
    'Repeated sync with identical feed data must be idempotent (0 records modified)'
  );
  assert.strictEqual(
    JSON.stringify(updatedCatalog),
    JSON.stringify(secondCatalog),
    'Catalog state must remain byte-for-byte identical on repeated idempotent sync'
  );

  // 11 & 12. Expand synced variants into separate Google Merchant Center feed items on export (CSV & RSS XML)
  const expandedRows = expandCatalogToExportRows(updatedCatalog);
  // 4 synced products (5 + 2 + 2 + 1 = 10 rows) + 2 unsynced products (1 + 1 = 2 rows) = 12 rows total
  assert.strictEqual(expandedRows.length, 12, 'Should expand catalog into 12 export rows');

  const exportedTeeRows = expandedRows.filter(
    (r) => r.item_group_id === 'group-uuid-maclarens-tee'
  );
  assert.strictEqual(exportedTeeRows.length, 5, 'Should export 5 rows for MacLaren Tee');
  assert.deepStrictEqual(
    exportedTeeRows.map((r) => r.id),
    ['uuid-tee-s', 'uuid-tee-m', 'uuid-tee-l', 'uuid-tee-xl', 'uuid-tee-2xl'],
    'Each exported variant row must use its unique website <g:id>'
  );
  assert.deepStrictEqual(
    exportedTeeRows.map((r) => r.size),
    ['S', 'M', 'L', 'XL', '2XL'],
    'Each exported variant row must have its specific size'
  );
  assert.strictEqual(
    exportedTeeRows[4].price,
    '28.50 USD',
    '2XL variant must carry its variant-specific price (28.50 USD)'
  );
  assert.strictEqual(
    exportedTeeRows[4].availability,
    'out_of_stock',
    '2XL variant must carry its variant-specific availability (out_of_stock)'
  );
  for (const row of exportedTeeRows) {
    assert.strictEqual(
      row.title,
      "How I Met Your Mother Gift Tee - Custom Optimized MacLaren's Pub Shirt",
      'Every exported variant row must carry the catalog design custom title'
    );
    assert.strictEqual(
      row.description,
      'Custom AI-optimized description for MacLaren Pub Shirt with deep fan references.',
      'Every exported variant row must carry the catalog design custom description'
    );
  }

  // Single-variant desk mat export check
  const exportedDeskMatRows = expandedRows.filter((r) => r.id === 'uuid-desk-mat-single');
  assert.strictEqual(exportedDeskMatRows.length, 1, 'Single-variant product must export as 1 row');
  assert.strictEqual(
    exportedDeskMatRows[0].item_group_id,
    '',
    'Single-variant exported row must have empty item_group_id'
  );

  // Validate exported feed rows
  const exportValidation = validateExportedFeedRows(updatedCatalog);
  assert.strictEqual(exportValidation.isValid, true, 'Exported feed rows must pass all validation checks');
  assert.strictEqual(exportValidation.errors.length, 0);

  // Verify CSV and RSS XML generation
  const csvOutput = generateMerchantCenterCsv(updatedCatalog);
  const parsedCsv = parseCsvText(csvOutput);
  assert.strictEqual(parsedCsv.length, 12, 'Generated CSV must contain 12 variant rows');

  const rssOutput = generateMerchantCenterRssXml(updatedCatalog);
  const reParsedRss = parseMerchantCenterRssXml(rssOutput);
  assert.strictEqual(reParsedRss.length, 12, 'Generated RSS XML must contain 12 valid <item> nodes');

  // 13. Security & Error Handling Tests: Malformed XML, XXE, SSRF, Disallowed URLs, Redirects, Timeouts, Oversized Responses
  // 13a. Malformed XML
  assert.throws(
    () => parseMerchantCenterRssXml('<rss><channel><item><g:id>123</g:id></channel></rss>'),
    /Unbalanced <item> tags/i,
    'Should reject unbalanced <item> tags'
  );

  // 13b. XXE / Entity Expansion attack
  const xxePayload = `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss><channel></channel></rss>`;
  assert.throws(
    () => parseMerchantCenterRssXml(xxePayload),
    /Security violation: XML DOCTYPE and ENTITY declarations are forbidden/i,
    'Should block XML DOCTYPE / ENTITY declarations (XXE defense)'
  );

  // 13c. Disallowed URLs & SSRF IP validation
  assert.strictEqual(isPrivateOrReservedIp('127.0.0.1'), true);
  assert.strictEqual(isPrivateOrReservedIp('10.0.0.1'), true);
  assert.strictEqual(isPrivateOrReservedIp('192.168.1.50'), true);
  assert.strictEqual(isPrivateOrReservedIp('169.254.169.254'), true);
  assert.strictEqual(isPrivateOrReservedIp('::1'), true);
  assert.strictEqual(isPrivateOrReservedIp('::ffff:127.0.0.1'), true);
  assert.strictEqual(isPrivateOrReservedIp('104.21.55.12'), false);

  await assert.rejects(
    () => validateFeedUrlAndResolveIp('http://shop.scienceofgifts.com/.well-known/merchant-center/rss.xml', MOCK_PUBLIC_DNS),
    /Disallowed protocol/i,
    'Should reject non-HTTPS URLs'
  );

  await assert.rejects(
    () => validateFeedUrlAndResolveIp('https://evil.example.com/.well-known/merchant-center/rss.xml', MOCK_PUBLIC_DNS),
    /Disallowed feed host/i,
    'Should reject non-allowlisted hostnames'
  );

  await assert.rejects(
    () => validateFeedUrlAndResolveIp('https://127.0.0.1/.well-known/merchant-center/rss.xml', MOCK_PUBLIC_DNS),
    /SSRF blocked/i,
    'Should reject loopback IP literals'
  );

  await assert.rejects(
    () =>
      validateFeedUrlAndResolveIp(APPROVED_WEBSITE_FEED_URL, async () => [
        { address: '169.254.169.254', family: 4 },
      ]),
    /SSRF blocked.*169\.254\.169\.254/i,
    'Should reject DNS resolution to cloud metadata / link-local IP'
  );

  // 13d. Redirect blocking
  await assert.rejects(
    () =>
      fetchWebsiteFeedXml(APPROVED_WEBSITE_FEED_URL, {
        dnsLookupFn: MOCK_PUBLIC_DNS,
        fetchFn: (async () =>
          ({
            status: 302,
            ok: false,
            headers: new Map([['location', 'http://169.254.169.254/latest/meta-data']]),
          }) as any) as typeof fetch,
      }),
    /Redirect blocked/i,
    'Should reject HTTP redirects'
  );

  // 13e. Oversized response limit
  await assert.rejects(
    () =>
      fetchWebsiteFeedXml(APPROVED_WEBSITE_FEED_URL, {
        dnsLookupFn: MOCK_PUBLIC_DNS,
        maxBytes: 100,
        fetchFn: (async () =>
          ({
            status: 200,
            ok: true,
            headers: new Map(),
            text: async () => 'x'.repeat(500),
          }) as any) as typeof fetch,
      }),
    /exceeded maximum allowed size/i,
    'Should reject oversized feed responses'
  );

  // 13f. Timeout handling
  await assert.rejects(
    () =>
      fetchWebsiteFeedXml(APPROVED_WEBSITE_FEED_URL, {
        dnsLookupFn: MOCK_PUBLIC_DNS,
        timeoutMs: 30,
        fetchFn: (async (_url: any, init: any) => {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const abortErr = new Error('The operation was aborted');
              abortErr.name = 'AbortError';
              reject(abortErr);
            });
          });
        }) as typeof fetch,
      }),
    /timed out after 30ms/i,
    'Should abort and reject when feed request times out'
  );

  // 14-22. Bulk Unmatched Design Selection, Selective Multi-Variant Import, Preservation, Idempotency & Atomic Failure Recovery
  const MULTI_UNMATCHED_RSS_FIXTURE = SAMPLE_RSS_FIXTURE.replace(
    '</channel>',
    `
    <!-- Second Unmatched Website Design with Multiple Variants (3 sizes: S, M, L) -->
    <item>
      <g:id>uuid-unmatched-hoodie-s</g:id>
      <g:item_group_id>group-uuid-paris-hoodie</g:item_group_id>
      <g:title><![CDATA[Paris is Always a Good Idea Hoodie]]></g:title>
      <g:description><![CDATA[Cozy Paris watercolor pullover hoodie.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/paris-is-always-a-good-idea-hoodie</g:link>
      <g:image_link>https://img.example.com/paris-s.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>57.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:mpn>MPN-PARIS-S</g:mpn>
      <g:color>Navy</g:color>
      <g:size>S</g:size>
      <g:condition>new</g:condition>
    </item>
    <item>
      <g:id>uuid-unmatched-hoodie-m</g:id>
      <g:item_group_id>group-uuid-paris-hoodie</g:item_group_id>
      <g:title><![CDATA[Paris is Always a Good Idea Hoodie]]></g:title>
      <g:description><![CDATA[Cozy Paris watercolor pullover hoodie.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/paris-is-always-a-good-idea-hoodie</g:link>
      <g:image_link>https://img.example.com/paris-m.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>57.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:mpn>MPN-PARIS-M</g:mpn>
      <g:color>Navy</g:color>
      <g:size>M</g:size>
      <g:condition>new</g:condition>
    </item>
    <item>
      <g:id>uuid-unmatched-hoodie-l</g:id>
      <g:item_group_id>group-uuid-paris-hoodie</g:item_group_id>
      <g:title><![CDATA[Paris is Always a Good Idea Hoodie]]></g:title>
      <g:description><![CDATA[Cozy Paris watercolor pullover hoodie.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/paris-is-always-a-good-idea-hoodie</g:link>
      <g:image_link>https://img.example.com/paris-l.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>61.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:mpn>MPN-PARIS-L</g:mpn>
      <g:color>Navy</g:color>
      <g:size>L</g:size>
      <g:condition>new</g:condition>
    </item>
  </channel>`
  );

  const multiUnmatchedVariants = parseMerchantCenterRssXml(MULTI_UNMATCHED_RSS_FIXTURE);
  const multiPreview = previewWebsiteFeedSync(initialCatalog, multiUnmatchedVariants);
  assert.strictEqual(
    multiPreview.unmatchedFeedGroups.length,
    2,
    'Should detect 2 unmatched website design groups (1 single-variant backpack + 1 3-variant hoodie)'
  );

  // 14. Default empty selection & computeUnmatchedSelectionReview counts
  const matchedSelection = new Set(multiPreview.matchedProducts.map((m) => m.catalogProductId));
  let unmatchedSelection = clearUnmatchedDesignSelection();
  let review0 = computeUnmatchedSelectionReview(multiPreview, matchedSelection, unmatchedSelection);
  assert.strictEqual(review0.totalUnmatchedDesigns, 2);
  assert.strictEqual(review0.totalUnmatchedVariants, 4); // 1 + 3
  assert.strictEqual(review0.selectedUnmatchedDesignsCount, 0);
  assert.strictEqual(review0.selectedUnmatchedVariantsCount, 0);
  assert.strictEqual(review0.selectionStatusLabel, '0 of 2 selected');

  // 15. Select All Unmatched Designs
  unmatchedSelection = selectAllUnmatchedDesigns(multiPreview);
  assert.strictEqual(unmatchedSelection.size, 2, 'Select All must select all 2 unmatched design groups');
  const reviewAll = computeUnmatchedSelectionReview(multiPreview, matchedSelection, unmatchedSelection);
  assert.strictEqual(reviewAll.selectedUnmatchedDesignsCount, 2);
  assert.strictEqual(reviewAll.selectedUnmatchedVariantsCount, 4, 'Selecting both unmatched designs must include all 4 variants');
  assert.strictEqual(reviewAll.selectionStatusLabel, '2 of 2 selected');
  assert.strictEqual(reviewAll.totalSelectedDesignsToApply, 6); // 4 matched + 2 unmatched
  assert.strictEqual(reviewAll.totalSelectedVariantsToApply, 14); // 10 matched + 4 unmatched

  // 16. Clear Selection without mutating catalog
  const catalogBeforeClear = JSON.stringify(initialCatalog);
  unmatchedSelection = clearUnmatchedDesignSelection();
  assert.strictEqual(unmatchedSelection.size, 0, 'Clear Selection must empty the selected set');
  const reviewCleared = computeUnmatchedSelectionReview(multiPreview, matchedSelection, unmatchedSelection);
  assert.strictEqual(reviewCleared.selectedUnmatchedDesignsCount, 0);
  assert.strictEqual(reviewCleared.selectedUnmatchedVariantsCount, 0);
  assert.strictEqual(reviewCleared.selectionStatusLabel, '0 of 2 selected');
  assert.strictEqual(
    JSON.stringify(initialCatalog),
    catalogBeforeClear,
    'Clearing selection must never modify catalog data'
  );

  // 17 & 18. Importing ONLY explicitly selected unmatched designs & importing multiple variants per design
  const parisGroupKey = 'gid:group-uuid-paris-hoodie';
  unmatchedSelection = toggleUnmatchedDesignSelection(unmatchedSelection, parisGroupKey);
  const reviewPartial = computeUnmatchedSelectionReview(multiPreview, matchedSelection, unmatchedSelection);
  assert.strictEqual(reviewPartial.selectedUnmatchedDesignsCount, 1);
  assert.strictEqual(reviewPartial.selectedUnmatchedVariantsCount, 3);
  assert.strictEqual(reviewPartial.selectionStatusLabel, '1 of 2 selected');

  const writerShirtBefore = JSON.stringify(initialCatalog.find((p) => p.id === 'writer-shirt'));
  const { updatedCatalog: selectiveCatalog, result: selectiveResult } = applyWebsiteFeedSync(
    initialCatalog,
    multiUnmatchedVariants,
    APPROVED_WEBSITE_FEED_URL,
    {
      approvedCatalogIds: Array.from(matchedSelection),
      importUnmatchedFeedGroupKeys: Array.from(unmatchedSelection),
    }
  );

  assert.strictEqual(
    selectiveResult.importedNewProductCount,
    1,
    'Must import ONLY the 1 explicitly selected unmatched design'
  );
  assert.strictEqual(
    selectiveCatalog.length,
    initialCatalog.length + 1,
    'Catalog count must increase by exactly 1'
  );
  assert.strictEqual(
    selectiveCatalog.some((p) => p.id === 'brand-new-dinosaur-backpack'),
    false,
    'Unselected unmatched design (dinosaur backpack) must NOT be imported'
  );

  const importedParisHoodie = selectiveCatalog.find(
    (p) => p.id === 'paris-is-always-a-good-idea-hoodie'
  );
  assert.ok(importedParisHoodie, 'Selected unmatched design (Paris Hoodie) must be imported');
  assert.strictEqual(
    importedParisHoodie.syncedVariants?.length,
    3,
    'Imported multi-variant design must retain all 3 website variants'
  );
  assert.deepStrictEqual(
    importedParisHoodie.syncedVariants?.map((v) => v.size),
    ['S', 'M', 'L'],
    'Imported multi-variant design must preserve exact variant sizes'
  );
  assert.strictEqual(
    importedParisHoodie.merchantData.item_group_id,
    'group-uuid-paris-hoodie',
    'Imported multi-variant design must carry shared item_group_id'
  );

  // 19 & 20. Preserve existing records/custom content and preserve app-only record (writer-shirt) byte-for-byte
  const writerShirtAfter = JSON.stringify(selectiveCatalog.find((p) => p.id === 'writer-shirt'));
  assert.strictEqual(
    writerShirtAfter,
    writerShirtBefore,
    'App-only record writer-shirt must be preserved byte-for-byte without modification'
  );

  const preservedMaclaren = selectiveCatalog.find((p) => p.id === 'maclarens-pub-t-shirt')!;
  assert.strictEqual(
    preservedMaclaren.merchantData.title,
    "How I Met Your Mother Gift Tee - Custom Optimized MacLaren's Pub Shirt",
    'Existing custom title must remain untouched when importing new designs'
  );

  // 21. Prevent duplicate products and variants when the same feed is imported again (even with same import keys passed)
  const snapshotAfterSelectiveImport = JSON.stringify(selectiveCatalog);
  const { updatedCatalog: reimportedCatalog, result: reimportResult } = applyWebsiteFeedSync(
    selectiveCatalog,
    multiUnmatchedVariants,
    APPROVED_WEBSITE_FEED_URL,
    {
      approvedCatalogIds: selectiveCatalog.map((p) => p.id),
      importUnmatchedFeedGroupKeys: [parisGroupKey],
    }
  );
  assert.strictEqual(
    reimportResult.importedNewProductCount,
    0,
    'Repeating the same import must not import duplicate products'
  );
  assert.strictEqual(
    reimportResult.updatedProductCount,
    0,
    'Repeating the same import must not modify already-synced products'
  );
  assert.strictEqual(
    JSON.stringify(reimportedCatalog),
    snapshotAfterSelectiveImport,
    'Catalog must remain byte-for-byte identical when repeating the same import'
  );

  // 22. Backup safety & interrupted/failed write protection (using isolated temp directory, never touching live catalog)
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sog-feed-sync-test-'));
  try {
    const tempCatalogPath = path.join(tempDir, 'catalog.json');
    const tempBackupsDir = path.join(tempDir, 'backups');
    fs.writeFileSync(tempCatalogPath, JSON.stringify(initialCatalog, null, 2), 'utf-8');
    const originalDiskBytes = fs.readFileSync(tempCatalogPath, 'utf-8');

    // Create two backups in the same millisecond/label and verify neither overwrites the other
    const backup1 = createCatalogBackup('unit-test', {
      sourceFilePath: tempCatalogPath,
      backupsDir: tempBackupsDir,
    });
    const backup2 = createCatalogBackup('unit-test', {
      sourceFilePath: tempCatalogPath,
      backupsDir: tempBackupsDir,
    });
    assert.notStrictEqual(backup1, backup2, 'Backups must never overwrite an existing backup file');
    assert.strictEqual(listCatalogBackups(tempBackupsDir).length, 2, 'Both backups must be retained');
    assert.strictEqual(
      fs.readFileSync(backup1, 'utf-8'),
      originalDiskBytes,
      'Backup content must match original catalog byte-for-byte'
    );

    // Simulate an interrupted/failed write halfway through writing the temp file
    assert.throws(
      () => {
        atomicWriteJson(tempCatalogPath, selectiveCatalog, (tempFilePath, serialized) => {
          // Write truncated/partial JSON to the temp file and then throw an error simulating crash/disk full
          fs.writeFileSync(tempFilePath, serialized.slice(0, 120), 'utf-8');
          throw new Error('Simulated disk write interruption during import');
        });
      },
      /Simulated disk write interruption/i,
      'Should propagate write error when import persistence is interrupted'
    );

    // Verify original catalog file on disk was NOT corrupted and no leftover .tmp files remain
    const afterFailedWriteBytes = fs.readFileSync(tempCatalogPath, 'utf-8');
    assert.strictEqual(
      afterFailedWriteBytes,
      originalDiskBytes,
      'Original catalog on disk must remain 100% intact and uncorrupted after an interrupted write'
    );
    const remainingFiles = fs.readdirSync(tempDir);
    assert.strictEqual(
      remainingFiles.some((f) => f.includes('.tmp.')),
      false,
      'Failed atomic write must clean up its temporary file'
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // 23. Policy-Compliant GTIN, MPN, and identifier_exists Validation with GS1 Modulo-10 Checksum Algorithm
  assert.strictEqual(isValidGtin('96385074'), true, '8-digit EAN-8 must be valid GTIN when Modulo-10 passes');
  assert.strictEqual(isValidGtin('012345678905'), true, '12-digit UPC must be valid GTIN when Modulo-10 passes');
  assert.strictEqual(isValidGtin('9780141036144'), true, '13-digit EAN/ISBN must be valid GTIN when Modulo-10 passes');
  assert.strictEqual(isValidGtin('10012345678902'), true, '14-digit ITF-14 must be valid GTIN when Modulo-10 passes');
  assert.strictEqual(isValidGtin('012345678909'), false, '12-digit UPC with invalid check digit must be rejected');
  assert.strictEqual(isValidGtin('96385075'), false, '8-digit EAN with invalid check digit must be rejected');
  assert.strictEqual(isValidGtin('9780123456789'), false, '13-digit EAN with invalid check digit must be rejected');
  assert.strictEqual(isValidGtin('000000000000'), false, 'All-zero dummy GTIN must be rejected');
  assert.strictEqual(isValidGtin('12345678'), false, 'Placeholder sequential GTIN must be rejected');
  assert.strictEqual(isValidGtin(''), false, 'Empty GTIN must be invalid');
  assert.strictEqual(isValidGtin('ABC123'), false, 'Alphanumeric GTIN must be invalid');

  assert.strictEqual(isGenuineMpn('ZM2K-TX7200S'), false, 'Fourthwall POD variant SKU must not be treated as genuine MPN');
  assert.strictEqual(isGenuineMpn('ZX0Z-8Q9200S'), false, 'Fourthwall POD variant SKU must not be treated as genuine MPN');
  assert.strictEqual(isGenuineMpn('MPN-TEE-S'), false, 'Internal test SKU must not be treated as genuine MPN');
  assert.strictEqual(isGenuineMpn('SONY-WH1000XM5'), true, 'Genuine OEM manufacturer part number must be accepted');

  // Test 5-way classification via determineProductIdentifiers:
  // Class 1: Genuine GTIN
  const genuineGtinIdentifiers = determineProductIdentifiers(
    '012345678905',
    '',
    '',
    '',
    'yes',
    'Science of Gifts'
  );
  assert.strictEqual(genuineGtinIdentifiers.classification, 'genuine_gtin');
  assert.strictEqual(genuineGtinIdentifiers.identifier_exists, 'yes');
  assert.strictEqual(genuineGtinIdentifiers.gtin, '012345678905');
  assert.strictEqual(genuineGtinIdentifiers.mpn, '');
  assert.strictEqual(genuineGtinIdentifiers.needsReview, false);

  // Class 2: Genuine OEM MPN
  const genuineMpnIdentifiers = determineProductIdentifiers(
    undefined,
    'SONY-WH1000XM5',
    undefined,
    undefined,
    'yes',
    'Sony',
    true
  );
  assert.strictEqual(genuineMpnIdentifiers.classification, 'genuine_mpn');
  assert.strictEqual(genuineMpnIdentifiers.identifier_exists, 'yes');
  assert.strictEqual(genuineMpnIdentifiers.gtin, '');
  assert.strictEqual(genuineMpnIdentifiers.mpn, 'SONY-WH1000XM5');
  assert.strictEqual(genuineMpnIdentifiers.needsReview, false);

  // Class 3: Internal Fulfillment SKU (Fourthwall POD variant SKU)
  const customPodIdentifiers = determineProductIdentifiers(
    undefined,
    'ZM2K-TX7200S',
    undefined,
    '',
    'no',
    'Science of Gifts'
  );
  assert.strictEqual(customPodIdentifiers.classification, 'internal_fulfillment_sku');
  assert.strictEqual(customPodIdentifiers.identifier_exists, 'no');
  assert.strictEqual(customPodIdentifiers.gtin, '');
  assert.strictEqual(customPodIdentifiers.mpn, '');
  assert.strictEqual(customPodIdentifiers.brand, 'Science of Gifts');
  assert.strictEqual(customPodIdentifiers.needsReview, false);

  // Class 4: Uncertain Provenance (unverified string)
  const uncertainIdentifiers = determineProductIdentifiers(
    undefined,
    'CUSTOM-PART-999',
    undefined,
    '',
    'no',
    'Science of Gifts',
    false
  );
  assert.strictEqual(uncertainIdentifiers.classification, 'uncertain_provenance');
  assert.strictEqual(uncertainIdentifiers.identifier_exists, 'no');
  assert.strictEqual(uncertainIdentifiers.gtin, '');
  assert.strictEqual(uncertainIdentifiers.mpn, '');
  assert.strictEqual(uncertainIdentifiers.needsReview, true);

  // Class 5: No Known Identifiers (Custom / POD items with no identifier strings)
  const noIdIdentifiers = determineProductIdentifiers(
    undefined,
    undefined,
    '',
    '',
    'no',
    'Science of Gifts'
  );
  assert.strictEqual(noIdIdentifiers.classification, 'no_identifiers');
  assert.strictEqual(noIdIdentifiers.identifier_exists, 'no');
  assert.strictEqual(noIdIdentifiers.gtin, '');
  assert.strictEqual(noIdIdentifiers.mpn, '');
  assert.strictEqual(noIdIdentifiers.needsReview, false);

  // 24. Single-variant vs Multi-variant item_group_id and XML identifier tags
  const testDeskMatProduct = selectiveCatalog.find((p) => p.id === 'how-i-met-your-mother-desk-mat')!;
  const deskMatExportRows = expandCatalogToExportRows([testDeskMatProduct]);
  assert.strictEqual(deskMatExportRows.length, 1);
  assert.strictEqual(deskMatExportRows[0].item_group_id, '', 'Single-variant product must have empty item_group_id');
  assert.strictEqual(deskMatExportRows[0].identifier_exists, 'no');
  assert.strictEqual(deskMatExportRows[0].gtin, '');
  assert.strictEqual(deskMatExportRows[0].mpn, '');

  const deskMatXml = generateMerchantCenterRssXml([testDeskMatProduct]);
  assert.ok(deskMatXml.includes('<g:identifier_exists>no</g:identifier_exists>'));
  assert.strictEqual(deskMatXml.includes('<g:gtin>'), false, 'RSS XML must not emit <g:gtin> when identifier_exists is no');
  assert.strictEqual(deskMatXml.includes('<g:mpn>'), false, 'RSS XML must not emit <g:mpn> when identifier_exists is no');
  assert.strictEqual(deskMatXml.includes('<g:item_group_id>'), false, 'RSS XML must not emit <g:item_group_id> for single-variant product');

  // 25. Complete 642-row feed validation across full catalog
  // Verify that our exported CSVs on disk (fixed and audited) have exactly 642 rows across 161 unique URLs with 0 errors
  const csvFilesToValidate = ['science_of_gifts_merchant_feed_fixed.csv', 'science_of_gifts_merchant_feed_audited.csv'];
  for (const csvFile of csvFilesToValidate) {
    if (fs.existsSync(csvFile)) {
      const csvText = fs.readFileSync(csvFile, 'utf-8');
      const parsedRows = parseCsvText(csvText);
      assert.strictEqual(parsedRows.length, 642, `${csvFile} must contain exactly 642 variant rows`);
      const uniqueUrls = new Set(parsedRows.map((r) => r.link.split('?')[0].replace(/\/$/, '')));
      assert.strictEqual(uniqueUrls.size, 161, `${csvFile} must span exactly 161 unique product URLs`);
      const emptyGidRows = parsedRows.filter((r) => !r.item_group_id || r.item_group_id.trim() === '');
      assert.strictEqual(emptyGidRows.length, 65, `Exactly 65 single-variant rows must omit item_group_id in ${csvFile}`);
      assert.strictEqual(
        parsedRows.every((r) => r.identifier_exists === 'no' && !r.gtin && !r.mpn),
        true,
        `All 642 custom POD merchandise rows must have identifier_exists=no, empty gtin, and empty mpn in ${csvFile}`
      );
      assert.strictEqual(
        parsedRows.every((r) => r.brand === 'Science of Gifts'),
        true,
        `All 642 rows must have brand="Science of Gifts" in ${csvFile}`
      );
    }
  }

  // ============================================================================
  // 26–34. Comprehensive Automated Verification for All 8 Required Sync Scenarios
  // ============================================================================

  // Scenario 1: Empty catalog with a complete website feed
  {
    const emptyCatalog: ProductItem[] = [];
    const emptyPreview = previewWebsiteFeedSync(emptyCatalog, parsedVariants);
    assert.strictEqual(emptyPreview.totalFeedVariantItems, 12, 'Website feed has 12 total variants');
    assert.strictEqual(emptyPreview.totalFeedDesignGroups, 6, 'Website feed has 6 grouped designs');
    assert.strictEqual(emptyPreview.summary.matchedCount, 0, 'Empty catalog has 0 matched products');
    assert.strictEqual(emptyPreview.summary.unmatchedFeedGroupCount, 6, 'All 6 website designs are genuinely new on empty catalog');
    assert.strictEqual(emptyPreview.summary.ambiguousCount, 0, 'Empty catalog has 0 ambiguous matches');
    assert.strictEqual(emptyPreview.summary.newVariantsForExistingCount, 0);
    assert.strictEqual(emptyPreview.summary.totalUnchangedProductsCount, 0);

    const allNewKeys = selectAllUnmatchedDesigns(emptyPreview);
    assert.strictEqual(allNewKeys.size, 6, 'Add All New Products selects all 6 genuinely new designs');

    const { updatedCatalog: populatedFromEmpty, result: emptySyncResult } = applyWebsiteFeedSync(
      emptyCatalog,
      parsedVariants,
      APPROVED_WEBSITE_FEED_URL,
      {
        approvedCatalogIds: [],
        importUnmatchedFeedGroupKeys: Array.from(allNewKeys),
      }
    );
    assert.strictEqual(emptySyncResult.syncMode, 'add_only', 'Default syncMode must be add_only');
    assert.strictEqual(emptySyncResult.importedNewProductCount, 6, 'Should import all 6 new products');
    assert.strictEqual(emptySyncResult.updatedProductCount, 0);
    assert.strictEqual(populatedFromEmpty.length, 6);
    const totalPopulatedVariants = populatedFromEmpty.reduce(
      (sum, p) => sum + (p.syncedVariants?.length || 0),
      0
    );
    assert.strictEqual(totalPopulatedVariants, 12, 'All 12 website variants must be stored across the 6 products');

    // Scenario 3 (on freshly populated catalog): Repeating synchronization without website changes
    const repeatPreviewOnPopulated = previewWebsiteFeedSync(populatedFromEmpty, parsedVariants);
    assert.strictEqual(repeatPreviewOnPopulated.summary.matchedCount, 6, 'All 6 products now match existing catalog');
    assert.strictEqual(repeatPreviewOnPopulated.summary.unmatchedFeedGroupCount, 0, '0 genuinely new products on repeat sync');
    assert.strictEqual(repeatPreviewOnPopulated.summary.newVariantsForExistingCount, 0, '0 missing variants on repeat sync');
    assert.strictEqual(repeatPreviewOnPopulated.summary.ambiguousCount, 0);
    assert.strictEqual(repeatPreviewOnPopulated.summary.totalUnchangedProductsCount, 6, 'All 6 products remain unchanged');

    const snapshotPopulated = JSON.stringify(populatedFromEmpty);
    const { updatedCatalog: repeatPopulated, result: repeatPopulatedResult } = applyWebsiteFeedSync(
      populatedFromEmpty,
      parsedVariants,
      APPROVED_WEBSITE_FEED_URL,
      {
        approvedCatalogIds: populatedFromEmpty.map((p) => p.id),
        importUnmatchedFeedGroupKeys: Array.from(allNewKeys), // even if stale keys passed, must not duplicate
      }
    );
    assert.strictEqual(repeatPopulatedResult.importedNewProductCount, 0);
    assert.strictEqual(repeatPopulatedResult.updatedProductCount, 0);
    assert.strictEqual(repeatPopulatedResult.attachedVariantsCount, 0);
    assert.strictEqual(repeatPopulatedResult.unchangedProductCount, 6);
    assert.strictEqual(JSON.stringify(repeatPopulated), snapshotPopulated, 'Repeated sync must create 0 records and 0 changes');
  }

  // Scenario 2: CSV-imported catalog synchronized for the first time (with tracking params, locale prefixes, Fourthwall domain)
  {
    const csvHeader = 'id,item_group_id,title,description,link,image_link,availability,price,brand,mpn,identifier_exists,color,size,condition,custom_label_0,custom_label_3';
    const csvRows = [
      // MacLaren's Tee with tracking parameters, locale prefix, and custom optimized title/labels
      `uuid-tee-s,group-uuid-maclarens-tee,"Custom CSV Optimized MacLaren's Pub Tee","Custom CSV description","https://shop.scienceofgifts.com/en-usd/products/maclarens-pub-t-shirt/?utm_source=google&variant=1","https://img.example.com/maclarens-s.jpg",in_stock,24.00 USD,Science of Gifts,MPN-TEE-S,no,Black,S,new,"Sitcom Fans","How I Met Your Mother"`,
      `uuid-tee-m,group-uuid-maclarens-tee,"Custom CSV Optimized MacLaren's Pub Tee","Custom CSV description","https://shop.scienceofgifts.com/en-usd/products/maclarens-pub-t-shirt/?utm_source=google&variant=2","https://img.example.com/maclarens-m.jpg",in_stock,24.00 USD,Science of Gifts,MPN-TEE-M,no,Black,M,new,"Sitcom Fans","How I Met Your Mother"`,
      `uuid-tee-l,group-uuid-maclarens-tee,"Custom CSV Optimized MacLaren's Pub Tee","Custom CSV description","https://shop.scienceofgifts.com/en-usd/products/maclarens-pub-t-shirt/?utm_source=google&variant=3","https://img.example.com/maclarens-l.jpg",in_stock,24.00 USD,Science of Gifts,MPN-TEE-L,no,Black,L,new,"Sitcom Fans","How I Met Your Mother"`,
      `uuid-tee-xl,group-uuid-maclarens-tee,"Custom CSV Optimized MacLaren's Pub Tee","Custom CSV description","https://shop.scienceofgifts.com/en-usd/products/maclarens-pub-t-shirt/?utm_source=google&variant=4","https://img.example.com/maclarens-xl.jpg",in_stock,24.00 USD,Science of Gifts,MPN-TEE-XL,no,Black,XL,new,"Sitcom Fans","How I Met Your Mother"`,
      `uuid-tee-2xl,group-uuid-maclarens-tee,"Custom CSV Optimized MacLaren's Pub Tee","Custom CSV description","https://shop.scienceofgifts.com/en-usd/products/maclarens-pub-t-shirt/?utm_source=google&variant=5","https://img.example.com/maclarens-2xl.jpg",out_of_stock,28.50 USD,Science of Gifts,MPN-TEE-2XL,no,Black,2XL,new,"Sitcom Fans","How I Met Your Mother"`,
      // Gettysburg Mug using fourthwall domain and http://
      `uuid-mug-11oz,group-uuid-gettysburg-mug,"Custom CSV Gettysburg 1863 Mug","Custom CSV mug description","http://scienceofgifts.fourthwall.com/en-us/products/gettysburg-1863-coffee-mug/?fbclid=abc","https://img.example.com/mug-11.jpg",in_stock,16.99 USD,Science of Gifts,MPN-MUG-11,no,White,11 oz,new,"History Buffs","American History"`,
      `uuid-mug-15oz,group-uuid-gettysburg-mug,"Custom CSV Gettysburg 1863 Mug","Custom CSV mug description","http://scienceofgifts.fourthwall.com/en-us/products/gettysburg-1863-coffee-mug/?fbclid=def","https://img.example.com/mug-15.jpg",in_stock,19.99 USD,Science of Gifts,MPN-MUG-15,no,White,15 oz,new,"History Buffs","American History"`,
      // Desk Mat single variant
      `uuid-desk-mat-single,,"Custom CSV Desk Mat","Custom CSV mat description","https://www.shop.scienceofgifts.com/fr-ca/products/how-i-met-your-mother-desk-mat/#top","https://img.example.com/desk-mat.jpg",in_stock,19.90 USD,Science of Gifts,MPN-DESKMAT-01,no,Multicolor,15.5 x 31.5 inches,new,"Office Gifts","How I Met Your Mother"`,
    ].join('\n');

    const { updatedCatalog: csvCatalog } = applyCsvCatalogImport([], `${csvHeader}\n${csvRows}`, 'merge');
    assert.strictEqual(csvCatalog.length, 3, 'CSV import creates 3 grouped products');

    const firstSyncPreview = previewWebsiteFeedSync(csvCatalog, parsedVariants);
    assert.strictEqual(firstSyncPreview.summary.matchedCount, 3, 'All 3 CSV-imported products match website feed despite URL/locale/domain differences');
    assert.strictEqual(firstSyncPreview.summary.newVariantsForExistingCount, 0, 'All variants on the 3 CSV products already exist');
    assert.strictEqual(firstSyncPreview.summary.unmatchedFeedGroupCount, 3, 'Remaining 3 website products are genuinely new');
    assert.strictEqual(firstSyncPreview.summary.totalUnchangedProductsCount, 3, 'All 3 existing CSV products will remain unchanged');

    const csvBeforeSnapshot = JSON.stringify(csvCatalog);
    const { updatedCatalog: afterFirstSync, result: firstSyncRes } = applyWebsiteFeedSync(
      csvCatalog,
      parsedVariants,
      APPROVED_WEBSITE_FEED_URL,
      {
        approvedCatalogIds: Array.from(selectMatchedWithNewVariants(firstSyncPreview)),
        importUnmatchedFeedGroupKeys: Array.from(selectAllUnmatchedDesigns(firstSyncPreview)),
      }
    );
    assert.strictEqual(firstSyncRes.importedNewProductCount, 3, 'Imports the 3 genuinely new website products');
    assert.strictEqual(firstSyncRes.updatedProductCount, 0, '0 existing CSV products modified in add_only mode');
    assert.strictEqual(firstSyncRes.attachedVariantsCount, 0);
    assert.strictEqual(afterFirstSync.length, 6);
    assert.strictEqual(
      JSON.stringify(afterFirstSync.slice(0, 3)),
      csvBeforeSnapshot,
      'Original 3 CSV-imported products remain byte-for-byte untouched in add_only mode'
    );
  }

  // Scenario 4: Five genuinely new products added to the website
  {
    const baseSync = applyWebsiteFeedSync(
      [],
      parsedVariants,
      APPROVED_WEBSITE_FEED_URL,
      {
        approvedCatalogIds: [],
        importUnmatchedFeedGroupKeys: Array.from(selectAllUnmatchedDesigns(previewWebsiteFeedSync([], parsedVariants))),
      }
    ).updatedCatalog;
    assert.strictEqual(baseSync.length, 6);

    const fiveNewItemsXml = [1, 2, 3, 4, 5]
      .map(
        (num) => `
    <item>
      <g:id>uuid-new-prod-${num}-s</g:id>
      <g:item_group_id>group-new-prod-${num}</g:item_group_id>
      <g:title><![CDATA[Genuinely New Science Gift #${num}]]></g:title>
      <g:description><![CDATA[Brand new physics design #${num}.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/genuinely-new-science-gift-${num}</g:link>
      <g:image_link>https://img.example.com/new-${num}-s.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>29.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:color>Navy</g:color>
      <g:size>S</g:size>
      <g:condition>new</g:condition>
    </item>
    <item>
      <g:id>uuid-new-prod-${num}-m</g:id>
      <g:item_group_id>group-new-prod-${num}</g:item_group_id>
      <g:title><![CDATA[Genuinely New Science Gift #${num}]]></g:title>
      <g:description><![CDATA[Brand new physics design #${num}.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/genuinely-new-science-gift-${num}</g:link>
      <g:image_link>https://img.example.com/new-${num}-m.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>29.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:color>Navy</g:color>
      <g:size>M</g:size>
      <g:condition>new</g:condition>
    </item>`
      )
      .join('\n');

    const feedWithFiveNew = parseMerchantCenterRssXml(
      SAMPLE_RSS_FIXTURE.replace('</channel>', `${fiveNewItemsXml}\n  </channel>`)
    );
    const previewFiveNew = previewWebsiteFeedSync(baseSync, feedWithFiveNew);
    assert.strictEqual(previewFiveNew.summary.matchedCount, 6, 'Existing 6 products match');
    assert.strictEqual(previewFiveNew.summary.unmatchedFeedGroupCount, 5, 'Detects exactly 5 genuinely new products');
    assert.strictEqual(previewFiveNew.summary.newProductsVariantCount, 10, '5 new products carry 10 total variants');
    assert.strictEqual(previewFiveNew.summary.newVariantsForExistingCount, 0, '0 new variants for existing products');
    assert.strictEqual(previewFiveNew.summary.totalUnchangedProductsCount, 6, 'All 6 existing products remain unchanged');

    const { updatedCatalog: afterFiveNew, result: fiveNewResult } = applyWebsiteFeedSync(
      baseSync,
      feedWithFiveNew,
      APPROVED_WEBSITE_FEED_URL,
      {
        approvedCatalogIds: Array.from(selectMatchedWithNewVariants(previewFiveNew)),
        importUnmatchedFeedGroupKeys: Array.from(selectAllUnmatchedDesigns(previewFiveNew)),
      }
    );
    assert.strictEqual(fiveNewResult.importedNewProductCount, 5, 'Adds only the 5 genuinely new products');
    assert.strictEqual(fiveNewResult.updatedProductCount, 0, 'Touches 0 existing products');
    assert.strictEqual(afterFiveNew.length, 11, 'Catalog grows from 6 to 11 products');

    // Repeat sync after adding 5 new products
    const { updatedCatalog: repeatAfterFive, result: repeatFiveResult } = applyWebsiteFeedSync(
      afterFiveNew,
      feedWithFiveNew
    );
    assert.strictEqual(repeatFiveResult.importedNewProductCount, 0);
    assert.strictEqual(repeatFiveResult.updatedProductCount, 0);
    assert.strictEqual(JSON.stringify(repeatAfterFive), JSON.stringify(afterFiveNew), 'Idempotent after adding 5 products');
  }

  // Scenario 5 & 6: New sizes or colors added to an existing product + Existing product with an edited Merchant Center title
  {
    const baseCatalog = applyWebsiteFeedSync(
      [],
      parsedVariants,
      APPROVED_WEBSITE_FEED_URL,
      {
        approvedCatalogIds: [],
        importUnmatchedFeedGroupKeys: Array.from(selectAllUnmatchedDesigns(previewWebsiteFeedSync([], parsedVariants))),
      }
    ).updatedCatalog;

    // Manually edit the Merchant Center title, description, price, custom labels, and optimization metadata on MacLaren's Tee
    const teeIndex = baseCatalog.findIndex((p) => p.merchantData.item_group_id === 'group-uuid-maclarens-tee');
    assert.ok(teeIndex >= 0);
    baseCatalog[teeIndex] = {
      ...baseCatalog[teeIndex],
      merchantData: {
        ...baseCatalog[teeIndex].merchantData,
        title: "Manually Edited MacLaren's Pub Graphic Tee - Sitcom Fan Gift",
        description: 'Manually edited description with custom keywords.',
        price: '24.00 USD', // deliberately different from feed's 26.00 USD to prove add_only does not overwrite price
        custom_label_0: 'VIP Best Seller',
        custom_label_3: 'Custom HIMYM Collection',
      },
      evidence: {
        ...baseCatalog[teeIndex].evidence,
        userCorrections: { title: "Manually Edited MacLaren's Pub Graphic Tee - Sitcom Fan Gift" },
      },
      fieldProvenance: {
        title: 'USER_EDITED',
        description: 'USER_EDITED',
        color: 'VERIFIED',
      },
    };

    // Website feed adds 2 new variants to MacLaren's Tee: 3XL (Black) and L (Forest Green)
    const feedWithNewSizeAndColor = parseMerchantCenterRssXml(
      SAMPLE_RSS_FIXTURE.replace(
        '<!-- Non-Clothing Size Variants: Mug (11 oz & 15 oz) -->',
        `
    <item>
      <g:id>uuid-tee-3xl</g:id>
      <g:item_group_id>group-uuid-maclarens-tee</g:item_group_id>
      <g:title><![CDATA[MacLaren's Pub T-Shirt]]></g:title>
      <g:description><![CDATA[Raw storefront description for MacLaren's Pub T-shirt.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/maclarens-pub-t-shirt</g:link>
      <g:image_link>https://img.example.com/maclarens-3xl.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>30.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:mpn>MPN-TEE-3XL</g:mpn>
      <g:color>Black</g:color>
      <g:size>3XL</g:size>
      <g:condition>new</g:condition>
    </item>
    <item>
      <g:id>uuid-tee-green-l</g:id>
      <g:item_group_id>group-uuid-maclarens-tee</g:item_group_id>
      <g:title><![CDATA[MacLaren's Pub T-Shirt]]></g:title>
      <g:description><![CDATA[Raw storefront description for MacLaren's Pub T-shirt.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/maclarens-pub-t-shirt</g:link>
      <g:image_link>https://img.example.com/maclarens-green-l.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>26.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:mpn>MPN-TEE-GREEN-L</g:mpn>
      <g:color>Forest Green</g:color>
      <g:size>L</g:size>
      <g:condition>new</g:condition>
    </item>
    <!-- Non-Clothing Size Variants: Mug (11 oz & 15 oz) -->`
      )
    );

    const variantAddPreview = previewWebsiteFeedSync(baseCatalog, feedWithNewSizeAndColor);
    assert.strictEqual(variantAddPreview.summary.matchedCount, 6);
    assert.strictEqual(variantAddPreview.summary.unmatchedFeedGroupCount, 0, 'Must NOT create a new product for new variants');
    assert.strictEqual(variantAddPreview.summary.matchedWithNewVariantsCount, 1, '1 existing product has new variants');
    assert.strictEqual(variantAddPreview.summary.newVariantsForExistingCount, 2, 'Detects 2 new variants (3XL and Forest Green)');
    assert.strictEqual(variantAddPreview.summary.totalUnchangedProductsCount, 5, 'Other 5 products remain unchanged');

    const autoSelectedMatchedIds = selectMatchedWithNewVariants(variantAddPreview);
    assert.strictEqual(autoSelectedMatchedIds.size, 1);
    assert.ok(autoSelectedMatchedIds.has(baseCatalog[teeIndex].id));

    const { updatedCatalog: afterVariantAdd, result: variantAddResult } = applyWebsiteFeedSync(
      baseCatalog,
      feedWithNewSizeAndColor,
      APPROVED_WEBSITE_FEED_URL,
      {
        approvedCatalogIds: Array.from(autoSelectedMatchedIds),
        importUnmatchedFeedGroupKeys: [],
      }
    );
    assert.strictEqual(variantAddResult.importedNewProductCount, 0);
    assert.strictEqual(variantAddResult.updatedProductCount, 1);
    assert.strictEqual(variantAddResult.attachedVariantsCount, 2, 'Attached exactly 2 new variants');
    assert.strictEqual(variantAddResult.unchangedProductCount, 5);
    assert.strictEqual(afterVariantAdd.length, 6, 'Catalog product count remains 6');

    const updatedTee = afterVariantAdd[teeIndex];
    assert.strictEqual(updatedTee.syncedVariants?.length, 7, 'MacLaren Tee now has 5 + 2 = 7 syncedVariants');
    assert.deepStrictEqual(
      updatedTee.syncedVariants?.map((v) => v.id),
      ['uuid-tee-s', 'uuid-tee-m', 'uuid-tee-l', 'uuid-tee-xl', 'uuid-tee-2xl', 'uuid-tee-3xl', 'uuid-tee-green-l']
    );
    // Verify Scenario 6: Edited title, description, price, labels, and fieldProvenance are strictly preserved
    assert.strictEqual(
      updatedTee.merchantData.title,
      "Manually Edited MacLaren's Pub Graphic Tee - Sitcom Fan Gift",
      'Edited Merchant Center title must remain untouched'
    );
    assert.strictEqual(
      updatedTee.merchantData.description,
      'Manually edited description with custom keywords.',
      'Edited description must remain untouched'
    );
    assert.strictEqual(
      updatedTee.merchantData.price,
      '24.00 USD',
      'In default add_only mode, existing product price must not be overwritten'
    );
    assert.strictEqual(updatedTee.merchantData.custom_label_0, 'VIP Best Seller');
    assert.strictEqual(updatedTee.merchantData.custom_label_3, 'Custom HIMYM Collection');
    assert.strictEqual(updatedTee.fieldProvenance?.title, 'USER_EDITED');

    // Repeating sync again adds 0 variants
    const { result: repeatVariantAddResult } = applyWebsiteFeedSync(
      afterVariantAdd,
      feedWithNewSizeAndColor
    );
    assert.strictEqual(repeatVariantAddResult.updatedProductCount, 0);
    assert.strictEqual(repeatVariantAddResult.attachedVariantsCount, 0);
  }

  // Scenario 7: Products with the same title but different URLs
  {
    const sameTitleXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <item>
      <g:id>uuid-schrodinger-tee</g:id>
      <g:item_group_id>group-schrodinger-tee</g:item_group_id>
      <g:title><![CDATA[Schrodinger's Cat Quantum Physics Gift]]></g:title>
      <g:description><![CDATA[T-Shirt version of Schrodinger's Cat.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/schrodingers-cat-t-shirt</g:link>
      <g:image_link>https://img.example.com/schrodinger-tee.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>25.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:condition>new</g:condition>
    </item>
    <item>
      <g:id>uuid-schrodinger-hoodie</g:id>
      <g:item_group_id>group-schrodinger-hoodie</g:item_group_id>
      <g:title><![CDATA[Schrodinger's Cat Quantum Physics Gift]]></g:title>
      <g:description><![CDATA[Hoodie version of Schrodinger's Cat with identical title.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/schrodingers-cat-hoodie</g:link>
      <g:image_link>https://img.example.com/schrodinger-hoodie.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>48.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:condition>new</g:condition>
    </item>
  </channel>
</rss>`;

    const sameTitleVariants = parseMerchantCenterRssXml(sameTitleXml);
    const sameTitleGroups = groupFeedVariantsByDesign(sameTitleVariants);
    assert.strictEqual(
      sameTitleGroups.length,
      2,
      'Two website products with the exact same title but different URLs must never be grouped together'
    );

    // Sub-case 7a: Catalog has an existing product with the same title but a different URL and no matching IDs -> must NOT merge by title similarity; must flag as ambiguous for manual review
    const catalogWithSameTitleDifferentUrl: ProductItem[] = [
      createSampleCatalogProduct({
        id: 'schrodingers-cat-legacy-edition',
        link: 'https://shop.scienceofgifts.com/products/schrodingers-cat-legacy-edition',
        title: "Schrodinger's Cat Quantum Physics Gift",
        description: 'Legacy product with identical title but different URL.',
        item_group_id: 'group-schrodinger-legacy',
      }),
    ];
    const previewSameTitleAmbiguous = previewWebsiteFeedSync(
      catalogWithSameTitleDifferentUrl,
      [sameTitleVariants[0]]
    );
    assert.strictEqual(
      previewSameTitleAmbiguous.matchedProducts.length,
      0,
      'Must NEVER auto-merge products based on title similarity alone'
    );
    assert.strictEqual(
      previewSameTitleAmbiguous.ambiguousMatches.length,
      1,
      'Same-title different-URL product against unmatched catalog item is flagged for manual review'
    );
    assert.strictEqual(
      previewSameTitleAmbiguous.unmatchedFeedGroups.length,
      0,
      'Ambiguous match is NOT placed in auto-approved new products list'
    );
    assert.strictEqual(
      selectAllUnmatchedDesigns(previewSameTitleAmbiguous).size,
      0,
      'Add All New Products never auto-approves ambiguous matches'
    );

    // Sub-case 7b: Catalog already has the T-shirt (matched by URL & group ID), and website feed has BOTH the T-shirt and a Hoodie with the exact same title but different URL -> Hoodie must not be merged into T-shirt and is imported as a separate product
    const catalogWithTeeOnly: ProductItem[] = [
      createSampleCatalogProduct({
        id: 'schrodingers-cat-t-shirt',
        link: 'https://shop.scienceofgifts.com/products/schrodingers-cat-t-shirt',
        title: "Schrodinger's Cat Quantum Physics Gift",
        description: 'T-Shirt version in catalog.',
        item_group_id: 'group-schrodinger-tee',
      }),
    ];
    const previewTwoSameTitle = previewWebsiteFeedSync(catalogWithTeeOnly, sameTitleVariants);
    assert.strictEqual(previewTwoSameTitle.matchedProducts.length, 1, 'T-shirt matches existing T-shirt by URL/group ID');
    assert.strictEqual(previewTwoSameTitle.unmatchedFeedGroups.length, 1, 'Hoodie with same title but different URL is kept separate as a distinct new product');
    const { updatedCatalog: bothProductsCatalog } = applyWebsiteFeedSync(
      catalogWithTeeOnly,
      sameTitleVariants,
      APPROVED_WEBSITE_FEED_URL,
      {
        approvedCatalogIds: [],
        importUnmatchedFeedGroupKeys: Array.from(selectAllUnmatchedDesigns(previewTwoSameTitle)),
      }
    );
    assert.strictEqual(
      bothProductsCatalog.length,
      2,
      'Both products with the same title and different URLs exist as separate catalog records without merging'
    );
  }

  // Scenario 8: Conflicting identifiers requiring manual review
  {
    const conflictCatalog: ProductItem[] = [
      createSampleCatalogProduct({
        id: 'catalog-prod-alpha',
        link: 'https://shop.scienceofgifts.com/products/alpha-physics-mug',
        title: 'Alpha Physics Mug',
        description: 'Alpha description.',
        item_group_id: 'group-alpha-shared',
        mpn: 'MPN-ALPHA-1',
      }),
      createSampleCatalogProduct({
        id: 'catalog-prod-beta',
        link: 'https://shop.scienceofgifts.com/products/beta-chemistry-mug',
        title: 'Beta Chemistry Mug',
        description: 'Beta description.',
        item_group_id: 'group-beta-original',
        mpn: 'MPN-BETA-1',
      }),
      createSampleCatalogProduct({
        id: 'catalog-prod-gamma',
        link: 'https://shop.scienceofgifts.com/products/gamma-astronomy-poster',
        title: 'Gamma Astronomy Poster',
        description: 'Gamma description.',
        item_group_id: 'group-gamma-v1',
      }),
    ];

    const conflictingFeedXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <!-- Conflict A: item_group_id matches catalog-prod-alpha, but canonical URL matches catalog-prod-beta -->
    <item>
      <g:id>uuid-conflict-cross-product</g:id>
      <g:item_group_id>group-alpha-shared</g:item_group_id>
      <g:title><![CDATA[Cross-Product Conflict Item]]></g:title>
      <g:description><![CDATA[Conflicting group ID vs URL.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/beta-chemistry-mug</g:link>
      <g:image_link>https://img.example.com/conflict1.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>18.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:condition>new</g:condition>
    </item>
    <!-- Conflict B: Same canonical URL as catalog-prod-gamma, but contradictory item_group_id -->
    <item>
      <g:id>uuid-conflict-group-mismatch</g:id>
      <g:item_group_id>group-gamma-CONTRA-999</g:item_group_id>
      <g:title><![CDATA[Gamma Astronomy Poster]]></g:title>
      <g:description><![CDATA[Contradictory item_group_id on same URL.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/gamma-astronomy-poster</g:link>
      <g:image_link>https://img.example.com/conflict2.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>22.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:condition>new</g:condition>
    </item>
  </channel>
</rss>`;

    const conflictingVariants = parseMerchantCenterRssXml(conflictingFeedXml);
    const conflictPreview = previewWebsiteFeedSync(conflictCatalog, conflictingVariants);

    assert.strictEqual(
      conflictPreview.matchedProducts.length,
      0,
      'Conflicting identifiers must NEVER be auto-matched'
    );
    assert.strictEqual(
      conflictPreview.unmatchedFeedGroups.length,
      0,
      'Conflicting identifiers must NEVER be placed in pending auto-additions'
    );
    assert.strictEqual(
      conflictPreview.ambiguousMatches.length,
      2,
      'Both conflicting identifier items must be flagged in ambiguousMatches for manual review'
    );
    assert.strictEqual(
      selectAllUnmatchedDesigns(conflictPreview).size,
      0,
      'Add All New Products must select 0 items when only ambiguous matches exist'
    );

    const conflictBeforeSnapshot = JSON.stringify(conflictCatalog);
    const { updatedCatalog: conflictAfterApply, result: conflictApplyRes } = applyWebsiteFeedSync(
      conflictCatalog,
      conflictingVariants
    );
    assert.strictEqual(conflictApplyRes.importedNewProductCount, 0);
    assert.strictEqual(conflictApplyRes.updatedProductCount, 0);
    assert.strictEqual(
      JSON.stringify(conflictAfterApply),
      conflictBeforeSnapshot,
      'Applying sync without manual mappings must leave conflicting products completely untouched and never delete absent catalog items'
    );
  }

  // 34. Verify RSS XML parser rejects unsafe non-HTTP(S) link schemes (e.g., javascript: or data:)
  {
    const unsafeLinkXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <item>
      <g:id>uuid-unsafe-link</g:id>
      <g:title><![CDATA[Unsafe Link Product]]></g:title>
      <g:description><![CDATA[Test unsafe link rejection.]]></g:description>
      <g:link>javascript:alert(1)</g:link>
      <g:image_link>https://img.example.com/safe.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>19.00 USD</g:price>
    </item>
  </channel>
</rss>`;
    assert.throws(
      () => parseMerchantCenterRssXml(unsafeLinkXml),
      /Missing or invalid HTTP\(S\) <g:link>/i,
      'Item with javascript: <g:link> must be rejected with an error'
    );

    const unsafeImageXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <item>
      <g:id>uuid-safe-link-unsafe-img</g:id>
      <g:title><![CDATA[Safe Link Product]]></g:title>
      <g:description><![CDATA[Test unsafe image sanitization.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/safe-product</g:link>
      <g:image_link>javascript:alert(2)</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>19.00 USD</g:price>
    </item>
  </channel>
</rss>`;
    const sanitizedParsed = parseMerchantCenterRssXml(unsafeImageXml);
    assert.strictEqual(sanitizedParsed.length, 1);
    assert.strictEqual(sanitizedParsed[0].id, 'uuid-safe-link-unsafe-img');
    assert.strictEqual(sanitizedParsed[0].image_link, '', 'Unsafe javascript: <g:image_link> must be stripped to empty string');
  }

  console.log('✓ All 34 Website Feed Sync & Google Merchant Center Feed Validation test suites passed!');
}

runTests().catch((err) => {
  console.error('Website Feed Sync test failed:', err);
  process.exit(1);
});

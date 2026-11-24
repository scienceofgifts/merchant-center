import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import worker, { Env } from '../worker';
import { createSqliteD1Database } from '../server/devD1Adapter';
import { parseCsvText } from '../src/utils/csv';
import { APPROVED_WEBSITE_FEED_URL } from '../server/websiteFeedSync';

const MOCK_PUBLIC_DNS = async (_hostname: string) => [
  { address: '104.21.55.12', family: 4 },
];

const SAMPLE_CSV = [
  'id,item_group_id,title,description,link,image_link,availability,price,google_product_category,product_type,brand,gtin,mpn,identifier_exists,color,size,material,gender,age_group,condition,custom_label_0,custom_label_1,custom_label_2,custom_label_3,custom_label_4',
  'uuid-tee-s,group-uuid-maclarens-tee,"Optimized MacLaren\'s Pub Gift T-Shirt","Optimized sitcom fan description for MacLaren\'s Pub Tee.","https://shop.scienceofgifts.com/products/maclarens-pub-t-shirt","https://img.example.com/maclarens-s.jpg",in_stock,24.00 USD,"Apparel & Accessories > Clothing > Shirts & Tops","Apparel > T-Shirts","Science of Gifts",,,no,Black,S,100% Cotton,unisex,adult,new,"Sitcom Fans","$20 - $40","Year-Round Essential","How I Met Your Mother","T-Shirts"',
  'uuid-tee-m,group-uuid-maclarens-tee,"Optimized MacLaren\'s Pub Gift T-Shirt","Optimized sitcom fan description for MacLaren\'s Pub Tee.","https://shop.scienceofgifts.com/products/maclarens-pub-t-shirt","https://img.example.com/maclarens-m.jpg",in_stock,24.00 USD,"Apparel & Accessories > Clothing > Shirts & Tops","Apparel > T-Shirts","Science of Gifts",,,no,Black,M,100% Cotton,unisex,adult,new,"Sitcom Fans","$20 - $40","Year-Round Essential","How I Met Your Mother","T-Shirts"',
  'uuid-mug-11oz,group-uuid-gettysburg-mug,"Optimized Gettysburg 1863 Ceramic Mug","Optimized history teacher mug description.","https://shop.scienceofgifts.com/products/gettysburg-1863-coffee-mug","https://img.example.com/mug-11.jpg",in_stock,16.99 USD,"Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs","Drinkware > Mugs","Science of Gifts",,,no,White,11 oz,Ceramic,,,new,"History Buffs","Budget Gifts (< $20)","Year-Round Essential","American Civil War","Mugs"',
  'uuid-mug-15oz,group-uuid-gettysburg-mug,"Optimized Gettysburg 1863 Ceramic Mug","Optimized history teacher mug description.","https://shop.scienceofgifts.com/products/gettysburg-1863-coffee-mug","https://img.example.com/mug-15.jpg",in_stock,19.99 USD,"Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs","Drinkware > Mugs","Science of Gifts",,,no,White,15 oz,Ceramic,,,new,"History Buffs","Budget Gifts (< $20)","Year-Round Essential","American Civil War","Mugs"',
].join('\n');

const SAMPLE_FOURTHWALL_RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <g:title><![CDATA[Science of Gifts]]></g:title>
    <g:link>https://shop.scienceofgifts.com</g:link>
    <g:description><![CDATA[Science of Gifts]]></g:description>

    <!-- Existing Tee (S, M, plus newly added L variant on website) -->
    <item>
      <g:id>uuid-tee-s</g:id>
      <g:item_group_id>group-uuid-maclarens-tee</g:item_group_id>
      <g:title><![CDATA[Raw Storefront MacLaren's Pub T-Shirt]]></g:title>
      <g:description><![CDATA[Raw storefront description.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/maclarens-pub-t-shirt</g:link>
      <g:image_link>https://img.example.com/maclarens-s.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>26.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:color>Black</g:color>
      <g:size>S</g:size>
      <g:condition>new</g:condition>
    </item>
    <item>
      <g:id>uuid-tee-m</g:id>
      <g:item_group_id>group-uuid-maclarens-tee</g:item_group_id>
      <g:title><![CDATA[Raw Storefront MacLaren's Pub T-Shirt]]></g:title>
      <g:description><![CDATA[Raw storefront description.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/maclarens-pub-t-shirt</g:link>
      <g:image_link>https://img.example.com/maclarens-m.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>26.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:color>Black</g:color>
      <g:size>M</g:size>
      <g:condition>new</g:condition>
    </item>
    <item>
      <g:id>uuid-tee-l</g:id>
      <g:item_group_id>group-uuid-maclarens-tee</g:item_group_id>
      <g:title><![CDATA[Raw Storefront MacLaren's Pub T-Shirt]]></g:title>
      <g:description><![CDATA[Raw storefront description.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/maclarens-pub-t-shirt</g:link>
      <g:image_link>https://img.example.com/maclarens-l.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>26.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:color>Black</g:color>
      <g:size>L</g:size>
      <g:condition>new</g:condition>
    </item>

    <!-- Existing Mug (11 oz & 15 oz) -->
    <item>
      <g:id>uuid-mug-11oz</g:id>
      <g:item_group_id>group-uuid-gettysburg-mug</g:item_group_id>
      <g:title><![CDATA[Raw Storefront Gettysburg Mug]]></g:title>
      <g:description><![CDATA[Raw mug description.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/gettysburg-1863-coffee-mug</g:link>
      <g:image_link>https://img.example.com/mug-11.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>16.99 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:color>White</g:color>
      <g:size>11 oz</g:size>
      <g:condition>new</g:condition>
    </item>
    <item>
      <g:id>uuid-mug-15oz</g:id>
      <g:item_group_id>group-uuid-gettysburg-mug</g:item_group_id>
      <g:title><![CDATA[Raw Storefront Gettysburg Mug]]></g:title>
      <g:description><![CDATA[Raw mug description.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/gettysburg-1863-coffee-mug</g:link>
      <g:image_link>https://img.example.com/mug-15.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>19.99 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:color>White</g:color>
      <g:size>15 oz</g:size>
      <g:condition>new</g:condition>
    </item>

    <!-- Genuinely New Website Product (2 variants) -->
    <item>
      <g:id>uuid-new-spitfire-12x18</g:id>
      <g:item_group_id>group-uuid-spitfire-poster</g:item_group_id>
      <g:title><![CDATA[Spitfire Mk IX Blueprint Poster]]></g:title>
      <g:description><![CDATA[WWII RAF aviation blueprint poster.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/spitfire-mk-ix-blueprint-poster</g:link>
      <g:image_link>https://img.example.com/spitfire-1218.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>22.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:color>Navy</g:color>
      <g:size>12" x 18"</g:size>
      <g:condition>new</g:condition>
    </item>
    <item>
      <g:id>uuid-new-spitfire-18x24</g:id>
      <g:item_group_id>group-uuid-spitfire-poster</g:item_group_id>
      <g:title><![CDATA[Spitfire Mk IX Blueprint Poster]]></g:title>
      <g:description><![CDATA[WWII RAF aviation blueprint poster.]]></g:description>
      <g:link>https://shop.scienceofgifts.com/products/spitfire-mk-ix-blueprint-poster</g:link>
      <g:image_link>https://img.example.com/spitfire-1824.jpg</g:image_link>
      <g:availability>in stock</g:availability>
      <g:price>28.00 USD</g:price>
      <g:brand><![CDATA[Science of Gifts]]></g:brand>
      <g:color>Navy</g:color>
      <g:size>18" x 24"</g:size>
      <g:condition>new</g:condition>
    </item>
  </channel>
</rss>`;

async function runCloudflareWorkerD1Tests() {
  console.log('Running Cloudflare Worker + D1 End-to-End Verification Suite...');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sog-cf-worker-d1-test-'));
  const sqliteFile = path.join(tempDir, 'test-d1.sqlite');

  try {
    // 1. Verify production fails loudly (HTTP 503) when D1 binding (env.DB) is missing — never silently falling back
    {
      const missingBindingRes = await worker.fetch(
        new Request('https://optimizer.scienceofgifts.com/api/products'),
        { ENVIRONMENT: 'production' }
      );
      assert.equal(
        missingBindingRes.status,
        503,
        'Production Worker without env.DB binding must return HTTP 503'
      );
      const body: any = await missingBindingRes.json();
      assert.equal(body.success, false);
      assert.match(body.error, /Cloudflare D1 database binding \(env\.DB\) is missing/i);
    }

    // Create persistent SQLite-backed D1 database
    let d1 = createSqliteD1Database(sqliteFile);

    const mockFeedFetchOptions = {
      dnsLookupFn: MOCK_PUBLIC_DNS,
      fetchFn: (async () =>
        new Response(SAMPLE_FOURTHWALL_RSS_XML, {
          status: 200,
          headers: { 'Content-Type': 'application/rss+xml' },
        })) as typeof fetch,
    };

    const env: Env = {
      DB: d1,
      ENVIRONMENT: 'production',
      ASSETS: {
        fetch: async (req: Request | string) => {
          const url = typeof req === 'string' ? req : req.url;
          return new Response(`<!doctype html><html><body>SPA Asset for ${url}</body></html>`, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        },
      },
      __TEST_FEED_FETCH_OPTIONS__: mockFeedFetchOptions,
    };

    // 2. Import an existing Merchant Center CSV via Worker + D1
    {
      const previewRes = await worker.fetch(
        new Request('https://optimizer.scienceofgifts.com/api/import-csv/preview', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://optimizer.scienceofgifts.com',
          },
          body: JSON.stringify({ csvText: SAMPLE_CSV, mode: 'merge' }),
        }),
        env
      );
      assert.equal(previewRes.status, 200);
      const previewData: any = await previewRes.json();
      assert.equal(previewData.success, true);
      assert.equal(previewData.preview.uniqueProducts, 2);
      assert.equal(previewData.preview.totalCsvRows, 4);

      const importRes = await worker.fetch(
        new Request('https://optimizer.scienceofgifts.com/api/import-csv', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://optimizer.scienceofgifts.com',
          },
          body: JSON.stringify({ csvText: SAMPLE_CSV, mode: 'merge', confirmed: true }),
        }),
        env
      );
      assert.equal(importRes.status, 200);
      const importData: any = await importRes.json();
      assert.equal(importData.success, true);
      assert.equal(importData.catalogCount, 2, 'D1 catalog should contain 2 parent designs');
      assert.equal(importData.summary.newProductsAdded, 2);
      assert.equal(importData.summary.variantsAdded, 4);

      // Verify relational rows directly in D1 tables
      const prodCountRow = await d1
        .prepare('SELECT COUNT(*) as cnt FROM products')
        .first<{ cnt: number }>();
      const varCountRow = await d1
        .prepare('SELECT COUNT(*) as cnt FROM product_variants')
        .first<{ cnt: number }>();
      const idMapCountRow = await d1
        .prepare('SELECT COUNT(*) as cnt FROM product_identity_mappings')
        .first<{ cnt: number }>();
      assert.equal(prodCountRow?.cnt, 2, 'D1 products table must have 2 rows');
      assert.equal(varCountRow?.cnt, 4, 'D1 product_variants table must have 4 rows');
      assert.ok((idMapCountRow?.cnt || 0) >= 8, 'D1 product_identity_mappings table must be populated');
    }

    // 3. Import the exact same CSV again and confirm zero duplicates in D1
    {
      const repeatImportRes = await worker.fetch(
        new Request('https://optimizer.scienceofgifts.com/api/import-csv', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://optimizer.scienceofgifts.com',
          },
          body: JSON.stringify({ csvText: SAMPLE_CSV, mode: 'merge', confirmed: true }),
        }),
        env
      );
      assert.equal(repeatImportRes.status, 200);
      const repeatData: any = await repeatImportRes.json();
      assert.equal(repeatData.success, true);
      assert.equal(repeatData.catalogCount, 2, 'Catalog count must remain 2');
      assert.equal(repeatData.summary.newProductsAdded, 0, 'Zero new products on repeat CSV import');
      assert.equal(repeatData.summary.matchedProductsModified, 0, 'Zero products modified on repeat CSV import');
      assert.equal(repeatData.summary.variantsAdded, 0, 'Zero variants added on repeat CSV import');

      const varCountRow = await d1
        .prepare('SELECT COUNT(*) as cnt FROM product_variants')
        .first<{ cnt: number }>();
      assert.equal(varCountRow?.cnt, 4, 'D1 product_variants count must remain 4 with zero duplicates');
    }

    // 4 & 6. Synchronize the Fourthwall feed via Worker + D1: attach new variant (size L) + add newly discovered website product (Spitfire Poster)
    {
      const syncPreviewRes = await worker.fetch(
        new Request('https://optimizer.scienceofgifts.com/api/feed-sync/preview', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://optimizer.scienceofgifts.com',
          },
          body: JSON.stringify({ feedUrl: APPROVED_WEBSITE_FEED_URL }),
        }),
        env
      );
      assert.equal(syncPreviewRes.status, 200);
      const syncPreviewData: any = await syncPreviewRes.json();
      assert.equal(syncPreviewData.success, true);
      const preview = syncPreviewData.preview;
      assert.equal(preview.summary.matchedCount, 2, '2 existing products matched');
      assert.equal(preview.summary.newVariantsForExistingCount, 1, '1 missing variant (size L) on MacLaren Tee');
      assert.equal(preview.summary.unmatchedFeedGroupCount, 1, '1 genuinely new website product (Spitfire Poster)');
      assert.equal(preview.summary.totalUnchangedProductsCount, 1, '1 product (Gettysburg Mug) remains unchanged');

      const teeCatalogId = preview.matchedProducts.find(
        (m: any) => m.websiteItemGroupId === 'group-uuid-maclarens-tee'
      ).catalogProductId;
      const newPosterGroupKey = preview.unmatchedFeedGroups[0].groupKey;

      const syncApplyRes = await worker.fetch(
        new Request('https://optimizer.scienceofgifts.com/api/feed-sync/apply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://optimizer.scienceofgifts.com',
          },
          body: JSON.stringify({
            feedUrl: APPROVED_WEBSITE_FEED_URL,
            confirmed: true,
            options: {
              syncMode: 'add_only',
              approvedCatalogIds: [teeCatalogId],
              importUnmatchedFeedGroupKeys: [newPosterGroupKey],
            },
          }),
        }),
        env
      );
      assert.equal(syncApplyRes.status, 200);
      const syncApplyData: any = await syncApplyRes.json();
      assert.equal(syncApplyData.success, true);
      assert.equal(syncApplyData.result.syncMode, 'add_only');
      assert.equal(syncApplyData.result.importedNewProductCount, 1, '1 new product imported');
      assert.equal(syncApplyData.result.updatedProductCount, 1, '1 existing product had missing variant attached');
      assert.equal(syncApplyData.result.attachedVariantsCount, 1, '1 missing variant attached');
      assert.equal(syncApplyData.catalogCount, 3, 'Catalog now has 3 products');
      assert.match(syncApplyData.backupPath || '', /^d1:\/\/catalog_backups\//, 'D1 catalog backup created');
    }

    // 5. Repeat synchronization with the same Fourthwall feed and confirm zero new duplicate records
    {
      const repeatSyncRes = await worker.fetch(
        new Request('https://optimizer.scienceofgifts.com/api/feed-sync/apply', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://optimizer.scienceofgifts.com',
          },
          body: JSON.stringify({
            feedUrl: APPROVED_WEBSITE_FEED_URL,
            confirmed: true,
            options: {
              syncMode: 'add_only',
              approvedCatalogIds: ['group-uuid-maclarens-tee', 'group-uuid-gettysburg-mug', 'group-uuid-spitfire-poster'],
              importUnmatchedFeedGroupKeys: ['gid:group-uuid-spitfire-poster'],
            },
          }),
        }),
        env
      );
      assert.equal(repeatSyncRes.status, 200);
      const repeatSyncData: any = await repeatSyncRes.json();
      assert.equal(repeatSyncData.success, true);
      assert.equal(repeatSyncData.result.importedNewProductCount, 0, '0 new products on repeat sync');
      assert.equal(repeatSyncData.result.updatedProductCount, 0, '0 updated products on repeat sync');
      assert.equal(repeatSyncData.result.attachedVariantsCount, 0, '0 attached variants on repeat sync');
      assert.equal(repeatSyncData.result.unchangedProductCount, 3, 'All 3 products remain unchanged');
      assert.equal(repeatSyncData.catalogCount, 3);
    }

    // 7 & 8. Close and reopen the SQLite D1 database file to simulate a cold Worker restart, and verify persistence + preservation of optimized fields
    {
      d1.close();
      d1 = createSqliteD1Database(sqliteFile);
      env.DB = d1;

      const listRes = await worker.fetch(
        new Request('https://optimizer.scienceofgifts.com/api/products'),
        env
      );
      assert.equal(listRes.status, 200);
      const listData: any = await listRes.json();
      assert.equal(listData.success, true);
      assert.equal(listData.count, 3, 'All 3 products persist across Worker restart');

      const teeProduct = listData.products.find(
        (p: any) => p.merchantData.item_group_id === 'group-uuid-maclarens-tee'
      );
      assert.ok(teeProduct, 'MacLaren Tee must exist after reload');
      assert.equal(
        teeProduct.merchantData.title,
        "Optimized MacLaren's Pub Gift T-Shirt",
        'Optimized title must NOT be overwritten by raw storefront title during add-only sync'
      );
      assert.equal(
        teeProduct.merchantData.description,
        "Optimized sitcom fan description for MacLaren's Pub Tee.",
        'Optimized description must NOT be overwritten by raw storefront description'
      );
      assert.equal(teeProduct.merchantData.custom_label_0, 'Sitcom Fans');
      assert.equal(teeProduct.merchantData.custom_label_3, 'How I Met Your Mother');
      assert.equal(teeProduct.syncedVariants.length, 3, 'All 3 variants (S, M, and newly attached L) persist in D1');

      // Manually edit a product via PUT /api/products/:id and confirm persistence across reload
      const editRes = await worker.fetch(
        new Request(`https://optimizer.scienceofgifts.com/api/products/${encodeURIComponent(teeProduct.id)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://optimizer.scienceofgifts.com',
          },
          body: JSON.stringify({
            merchantData: {
              ...teeProduct.merchantData,
              title: "Custom Edited MacLaren's Pub Shirt - HIMYM Fan Gift",
            },
          }),
        }),
        env
      );
      assert.equal(editRes.status, 200);
      const editData: any = await editRes.json();
      assert.equal(editData.success, true);
      assert.equal(
        editData.product.merchantData.title,
        "Custom Edited MacLaren's Pub Shirt - HIMYM Fan Gift"
      );
      assert.equal(editData.product.fieldProvenance?.title, 'USER_EDITED');
    }

    // 9. Export a valid Merchant Center CSV from the Worker and verify all 7 variant rows (3 Tee + 2 Mug + 2 Poster)
    {
      const exportRes = await worker.fetch(
        new Request('https://optimizer.scienceofgifts.com/api/export-csv'),
        env
      );
      assert.equal(exportRes.status, 200);
      assert.match(exportRes.headers.get('Content-Type') || '', /text\/csv/i);
      const csvText = await exportRes.text();
      const exportedRows = parseCsvText(csvText);
      assert.equal(exportedRows.length, 7, 'Exported CSV must contain 3 + 2 + 2 = 7 variant rows');
      const teeRows = exportedRows.filter((r) => r.item_group_id === 'group-uuid-maclarens-tee');
      assert.equal(teeRows.length, 3);
      assert.ok(
        teeRows.every((r) => r.title === "Custom Edited MacLaren's Pub Shirt - HIMYM Fan Gift"),
        'All exported MacLaren Tee variant rows must carry the preserved custom edited title'
      );
    }

    // 10. Verify Static Assets delegation, Same-Origin CSRF blocking, and Admin Token Authentication
    {
      // Static assets delegation for frontend SPA route
      const spaRes = await worker.fetch(
        new Request('https://optimizer.scienceofgifts.com/workspace/maclarens'),
        env
      );
      assert.equal(spaRes.status, 200);
      const spaHtml = await spaRes.text();
      assert.match(spaHtml, /SPA Asset for https:\/\/optimizer\.scienceofgifts\.com\/workspace\/maclarens/);

      // Cross-origin mutation blocked with 403 Forbidden
      const csrfRes = await worker.fetch(
        new Request('https://optimizer.scienceofgifts.com/api/import-csv', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://evil-attacker.example.com',
          },
          body: JSON.stringify({ csvText: SAMPLE_CSV, mode: 'merge' }),
        }),
        env
      );
      assert.equal(csrfRes.status, 403, 'Cross-origin POST must be blocked with HTTP 403');

      // Authentication required when ADMIN_API_TOKEN is set
      const authedEnv: Env = {
        ...env,
        ADMIN_API_TOKEN: 'sog-super-secret-admin-token-2026',
      };

      const unauthRes = await worker.fetch(
        new Request('https://optimizer.scienceofgifts.com/api/products'),
        authedEnv
      );
      assert.equal(unauthRes.status, 401, 'Unauthenticated request must return HTTP 401');

      const wrongTokenRes = await worker.fetch(
        new Request('https://optimizer.scienceofgifts.com/api/products', {
          headers: { Authorization: 'Bearer wrong-token' },
        }),
        authedEnv
      );
      assert.equal(wrongTokenRes.status, 401, 'Wrong bearer token must return HTTP 401');

      const validTokenRes = await worker.fetch(
        new Request('https://optimizer.scienceofgifts.com/api/products', {
          headers: { Authorization: 'Bearer sog-super-secret-admin-token-2026' },
        }),
        authedEnv
      );
      assert.equal(validTokenRes.status, 200, 'Valid bearer token must return HTTP 200');
    }

    d1.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('✓ All 10 Cloudflare Worker + D1 production workflow tests passed!');
}

runCloudflareWorkerD1Tests().catch((err) => {
  console.error('Cloudflare Worker + D1 test suite failed:', err);
  process.exit(1);
});

-- ============================================================================
-- Science of Gifts Merchant Feed Optimizer — Cloudflare D1 Initial Schema
-- Migration: 0001_initial_schema.sql
-- ============================================================================

-- 1. Products (Parent catalog product designs, Merchant Center fields, and optimization metadata)
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  item_group_id TEXT NOT NULL DEFAULT '',
  canonical_url TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  link TEXT NOT NULL,
  image_link TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  availability TEXT NOT NULL DEFAULT 'in_stock',
  brand TEXT NOT NULL DEFAULT 'Science of Gifts',
  gtin TEXT NOT NULL DEFAULT '',
  mpn TEXT NOT NULL DEFAULT '',
  identifier_exists TEXT NOT NULL DEFAULT 'no',
  google_product_category TEXT NOT NULL DEFAULT '',
  product_type TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  material TEXT NOT NULL DEFAULT '',
  custom_label_0 TEXT NOT NULL DEFAULT '',
  custom_label_1 TEXT NOT NULL DEFAULT '',
  custom_label_2 TEXT NOT NULL DEFAULT '',
  custom_label_3 TEXT NOT NULL DEFAULT '',
  custom_label_4 TEXT NOT NULL DEFAULT '',
  product_group TEXT NOT NULL DEFAULT '',
  product_subgroup TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'not_analyzed',
  merchant_data_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  gift_intelligence_json TEXT NOT NULL,
  optimization_data_json TEXT NOT NULL,
  website_sync_meta_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_item_group_id ON products(item_group_id);
CREATE INDEX IF NOT EXISTS idx_products_canonical_url ON products(canonical_url);
CREATE INDEX IF NOT EXISTS idx_products_sort_order ON products(sort_order ASC, updated_at DESC);

-- 2. Product Variants (Individual size/color/capacity variants belonging to a parent product)
CREATE TABLE IF NOT EXISTS product_variants (
  variant_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  item_group_id TEXT NOT NULL DEFAULT '',
  canonical_url TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  price TEXT NOT NULL,
  sale_price TEXT NOT NULL DEFAULT '',
  availability TEXT NOT NULL DEFAULT 'in_stock',
  color TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  material TEXT NOT NULL DEFAULT '',
  mpn TEXT NOT NULL DEFAULT '',
  gtin TEXT NOT NULL DEFAULT '',
  identifier_exists TEXT NOT NULL DEFAULT 'no',
  link TEXT NOT NULL,
  image_link TEXT NOT NULL DEFAULT '',
  variant_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants(product_id, sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_product_variants_item_group_id ON product_variants(item_group_id);

-- 3. Stable Product Identity Mapppings (Enforces deterministic deduplication across variant IDs, item_group_id, canonical URLs, and MPN/SKUs)
CREATE TABLE IF NOT EXISTS product_identity_mappings (
  identity_key TEXT PRIMARY KEY,
  identity_type TEXT NOT NULL,
  product_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_identity_mappings_product_id ON product_identity_mappings(product_id);
CREATE INDEX IF NOT EXISTS idx_product_identity_mappings_type ON product_identity_mappings(identity_type);

-- 4. Website Synchronization Mappings (Tracks deterministic Fourthwall feed design group -> catalog product pairings)
CREATE TABLE IF NOT EXISTS website_sync_mappings (
  website_group_key TEXT PRIMARY KEY,
  product_id TEXT NOT NULL UNIQUE,
  website_item_group_id TEXT NOT NULL DEFAULT '',
  website_primary_variant_id TEXT NOT NULL DEFAULT '',
  canonical_product_url TEXT NOT NULL DEFAULT '',
  match_method TEXT NOT NULL,
  variant_count INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  sync_meta_json TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_website_sync_mappings_product_id ON website_sync_mappings(product_id);

-- 5. Catalog Settings (Stores global strategy configuration and taxonomy settings)
CREATE TABLE IF NOT EXISTS catalog_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 6. Catalog Backups (Stores non-overwriting timestamped catalog snapshots prior to CSV imports and Website Feed Syncs)
CREATE TABLE IF NOT EXISTS catalog_backups (
  backup_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  product_count INTEGER NOT NULL,
  catalog_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_backups_created_at ON catalog_backups(created_at DESC);

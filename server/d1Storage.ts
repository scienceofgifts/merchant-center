import {
  ProductItem,
  StrategyConfig,
  WebsiteVariant,
  WebsiteSyncMetadata,
  MerchantData,
  EvidenceModel,
  GiftIntelligence,
  AIStrategy,
  AIAudit,
  TitleCandidate,
  DeterministicValidation,
  FieldProvenanceStatus,
  FieldProvenanceMap,
  OptimizationSummary,
} from '../src/types/feed';
import { INITIAL_STRATEGY_CONFIG } from '../src/utils/taxonomy';
import { computeProductStatus } from '../src/utils/validation';
import { normalizeCanonicalProductUrl, isSpecificProductUrl } from './websiteFeedSync';

// ============================================================================
// Cloudflare D1 Standard TypeScript Interfaces
// ============================================================================

export interface D1Meta {
  duration?: number;
  changes?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
}

interface StoredOptimizationData {
  suggestedMerchantData?: Partial<MerchantData>;
  suggestedGiftIntelligence?: Partial<GiftIntelligence>;
  titleCandidates: TitleCandidate[];
  selectedTitleCandidateId?: string;
  strategy?: AIStrategy;
  audit?: AIAudit;
  validation: DeterministicValidation;
  fieldProvenance?: Record<string, FieldProvenanceStatus>;
  fieldProvenanceDetails?: FieldProvenanceMap;
  originalImported?: Partial<MerchantData>;
  lastOptimizationSummary?: OptimizationSummary;
  appliedSuggestions: Array<{ timestamp: string; fields: string[]; note: string }>;
  history: Array<{ timestamp: string; note: string; snapshot: Partial<MerchantData> }>;
}

interface D1ProductRow {
  id: string;
  item_group_id: string;
  canonical_url: string;
  title: string;
  description: string;
  link: string;
  image_link: string;
  price: string;
  availability: string;
  brand: string;
  gtin: string;
  mpn: string;
  identifier_exists: string;
  google_product_category: string;
  product_type: string;
  color: string;
  size: string;
  material: string;
  custom_label_0: string;
  custom_label_1: string;
  custom_label_2: string;
  custom_label_3: string;
  custom_label_4: string;
  product_group: string;
  product_subgroup: string;
  status: string;
  merchant_data_json: string;
  evidence_json: string;
  gift_intelligence_json: string;
  optimization_data_json: string;
  website_sync_meta_json: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface D1VariantRow {
  variant_id: string;
  product_id: string;
  item_group_id: string;
  canonical_url: string;
  title: string;
  price: string;
  sale_price: string;
  availability: string;
  color: string;
  size: string;
  material: string;
  mpn: string;
  gtin: string;
  identifier_exists: string;
  link: string;
  image_link: string;
  variant_json: string;
  sort_order: number;
  updated_at: string;
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS products (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_products_item_group_id ON products(item_group_id)`,
  `CREATE INDEX IF NOT EXISTS idx_products_canonical_url ON products(canonical_url)`,
  `CREATE INDEX IF NOT EXISTS idx_products_sort_order ON products(sort_order ASC, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS product_variants (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants(product_id, sort_order ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_product_variants_item_group_id ON product_variants(item_group_id)`,
  `CREATE TABLE IF NOT EXISTS product_identity_mappings (
    identity_key TEXT PRIMARY KEY,
    identity_type TEXT NOT NULL,
    product_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_product_identity_mappings_product_id ON product_identity_mappings(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_product_identity_mappings_type ON product_identity_mappings(identity_type)`,
  `CREATE TABLE IF NOT EXISTS website_sync_mappings (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_website_sync_mappings_product_id ON website_sync_mappings(product_id)`,
  `CREATE TABLE IF NOT EXISTS catalog_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS catalog_backups (
    backup_id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    product_count INTEGER NOT NULL,
    catalog_snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_backups_created_at ON catalog_backups(created_at DESC)`,
];

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Deduplicates a catalog array by stable product ID and deduplicates syncedVariants by stable variant ID
 * so unique constraints are always respected and duplicate records cannot be persisted.
 */
export function deduplicateCatalogItems(items: readonly ProductItem[]): ProductItem[] {
  const seenProductIds = new Set<string>();
  const seenVariantIds = new Set<string>();
  const deduplicated: ProductItem[] = [];

  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id.trim()) continue;
    const pid = item.id.trim();
    if (seenProductIds.has(pid)) continue;
    seenProductIds.add(pid);

    let cleanVariants: WebsiteVariant[] | undefined = undefined;
    if (Array.isArray(item.syncedVariants)) {
      cleanVariants = [];
      for (const v of item.syncedVariants) {
        if (!v || typeof v.id !== 'string' || !v.id.trim()) continue;
        const vid = v.id.trim();
        if (seenVariantIds.has(vid)) continue;
        seenVariantIds.add(vid);
        cleanVariants.push({ ...v, id: vid });
      }
    }

    deduplicated.push({
      ...item,
      id: pid,
      merchantData: {
        ...item.merchantData,
        id: pid,
      },
      syncedVariants: cleanVariants,
    });
  }

  return deduplicated;
}

/**
 * Cloudflare D1 Relational Storage Engine for Science of Gifts Merchant Feed Optimizer.
 * Persists products, variants, stable identity mappings, website synchronization mappings,
 * optimization data, settings, and timestamped backups using parameterized queries and atomic batches.
 */
export class D1CatalogStorage {
  private readonly db: D1Database;
  private schemaInitialized = false;
  private readonly onDevSyncCallback?: (items: ProductItem[]) => void;
  private readonly onDevStrategySyncCallback?: (config: StrategyConfig) => void;

  constructor(
    db: D1Database,
    options?: {
      onDevSyncCallback?: (items: ProductItem[]) => void;
      onDevStrategySyncCallback?: (config: StrategyConfig) => void;
    }
  ) {
    this.db = db;
    this.onDevSyncCallback = options?.onDevSyncCallback;
    this.onDevStrategySyncCallback = options?.onDevStrategySyncCallback;
  }

  async ensureSchema(): Promise<void> {
    if (this.schemaInitialized) return;
    const stmts = SCHEMA_STATEMENTS.map((sql) => this.db.prepare(sql));
    await this.db.batch(stmts);
    this.schemaInitialized = true;
  }

  private buildUpsertStatementsForProduct(
    product: ProductItem,
    sortOrder: number,
    claimedIdentityKeys?: Set<string>
  ): D1PreparedStatement[] {
    const stmts: D1PreparedStatement[] = [];
    const now = new Date().toISOString();
    const md = product.merchantData;
    const canonicalUrl = normalizeCanonicalProductUrl(md.link || product.evidence?.sourceUrl || '');
    const itemGroupId = (md.item_group_id || product.websiteSyncMeta?.websiteItemGroupId || '').trim();

    const optimizationData: StoredOptimizationData = {
      suggestedMerchantData: product.suggestedMerchantData,
      suggestedGiftIntelligence: product.suggestedGiftIntelligence,
      titleCandidates: product.titleCandidates || [],
      selectedTitleCandidateId: product.selectedTitleCandidateId,
      strategy: product.strategy,
      audit: product.audit,
      validation: product.validation || { isValid: true, blockingErrors: [], warnings: [] },
      fieldProvenance: product.fieldProvenance,
      fieldProvenanceDetails: product.fieldProvenanceDetails,
      originalImported: product.originalImported,
      lastOptimizationSummary: product.lastOptimizationSummary,
      appliedSuggestions: product.appliedSuggestions || [],
      history: product.history || [],
    };

    stmts.push(
      this.db
        .prepare(
          `INSERT INTO products (
            id, item_group_id, canonical_url, title, description, link, image_link,
            price, availability, brand, gtin, mpn, identifier_exists,
            google_product_category, product_type, color, size, material,
            custom_label_0, custom_label_1, custom_label_2, custom_label_3, custom_label_4,
            product_group, product_subgroup, status,
            merchant_data_json, evidence_json, gift_intelligence_json,
            optimization_data_json, website_sync_meta_json,
            sort_order, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?,
            ?, ?, ?
          )
          ON CONFLICT(id) DO UPDATE SET
            item_group_id = excluded.item_group_id,
            canonical_url = excluded.canonical_url,
            title = excluded.title,
            description = excluded.description,
            link = excluded.link,
            image_link = excluded.image_link,
            price = excluded.price,
            availability = excluded.availability,
            brand = excluded.brand,
            gtin = excluded.gtin,
            mpn = excluded.mpn,
            identifier_exists = excluded.identifier_exists,
            google_product_category = excluded.google_product_category,
            product_type = excluded.product_type,
            color = excluded.color,
            size = excluded.size,
            material = excluded.material,
            custom_label_0 = excluded.custom_label_0,
            custom_label_1 = excluded.custom_label_1,
            custom_label_2 = excluded.custom_label_2,
            custom_label_3 = excluded.custom_label_3,
            custom_label_4 = excluded.custom_label_4,
            product_group = excluded.product_group,
            product_subgroup = excluded.product_subgroup,
            status = excluded.status,
            merchant_data_json = excluded.merchant_data_json,
            evidence_json = excluded.evidence_json,
            gift_intelligence_json = excluded.gift_intelligence_json,
            optimization_data_json = excluded.optimization_data_json,
            website_sync_meta_json = excluded.website_sync_meta_json,
            sort_order = excluded.sort_order,
            updated_at = excluded.updated_at`
        )
        .bind(
          product.id,
          itemGroupId,
          canonicalUrl,
          md.title || '',
          md.description || '',
          md.link || '',
          md.image_link || '',
          md.price || '',
          md.availability || 'in_stock',
          md.brand || 'Science of Gifts',
          md.gtin || '',
          md.mpn || '',
          md.identifier_exists || 'no',
          md.google_product_category || '',
          md.product_type || '',
          md.color || '',
          md.size || '',
          md.material || '',
          md.custom_label_0 || '',
          md.custom_label_1 || '',
          md.custom_label_2 || '',
          md.custom_label_3 || '',
          md.custom_label_4 || '',
          product.productGroup || '',
          product.productSubgroup || '',
          product.status || 'not_analyzed',
          JSON.stringify(md),
          JSON.stringify(product.evidence || {}),
          JSON.stringify(product.giftIntelligence || {}),
          JSON.stringify(optimizationData),
          product.websiteSyncMeta ? JSON.stringify(product.websiteSyncMeta) : null,
          sortOrder,
          product.createdAt || now,
          product.updatedAt || now
        )
    );

    // Refresh product variants for this product
    stmts.push(this.db.prepare(`DELETE FROM product_variants WHERE product_id = ?`).bind(product.id));

    if (Array.isArray(product.syncedVariants) && product.syncedVariants.length > 0) {
      product.syncedVariants.forEach((variant, vIdx) => {
        if (!variant || !variant.id) return;
        const vCanonicalUrl = normalizeCanonicalProductUrl(variant.link || md.link || '');
        stmts.push(
          this.db
            .prepare(
              `INSERT INTO product_variants (
                variant_id, product_id, item_group_id, canonical_url, title,
                price, sale_price, availability, color, size, material,
                mpn, gtin, identifier_exists, link, image_link,
                variant_json, sort_order, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(variant_id) DO UPDATE SET
                product_id = excluded.product_id,
                item_group_id = excluded.item_group_id,
                canonical_url = excluded.canonical_url,
                title = excluded.title,
                price = excluded.price,
                sale_price = excluded.sale_price,
                availability = excluded.availability,
                color = excluded.color,
                size = excluded.size,
                material = excluded.material,
                mpn = excluded.mpn,
                gtin = excluded.gtin,
                identifier_exists = excluded.identifier_exists,
                link = excluded.link,
                image_link = excluded.image_link,
                variant_json = excluded.variant_json,
                sort_order = excluded.sort_order,
                updated_at = excluded.updated_at`
            )
            .bind(
              variant.id,
              product.id,
              variant.item_group_id || itemGroupId || '',
              vCanonicalUrl,
              variant.title || md.title || '',
              variant.price || md.price || '',
              variant.sale_price || '',
              variant.availability || 'in_stock',
              variant.color || '',
              variant.size || '',
              variant.material || '',
              variant.mpn || '',
              variant.gtin || '',
              variant.identifier_exists || 'no',
              variant.link || md.link || '',
              variant.image_link || md.image_link || '',
              JSON.stringify(variant),
              vIdx,
              now
            )
        );
      });
    }

    // Refresh product identity mappings for deterministic matching & deduplication
    stmts.push(
      this.db.prepare(`DELETE FROM product_identity_mappings WHERE product_id = ?`).bind(product.id)
    );

    const addIdentityMapping = (key: string, type: string) => {
      if (!key) return;
      if (claimedIdentityKeys) {
        if (claimedIdentityKeys.has(key)) return;
        claimedIdentityKeys.add(key);
      }
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO product_identity_mappings (identity_key, identity_type, product_id, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(identity_key) DO UPDATE SET
               identity_type = excluded.identity_type,
               product_id = excluded.product_id,
               updated_at = excluded.updated_at`
          )
          .bind(key, type, product.id, now)
      );
    };

    addIdentityMapping(`pid:${product.id}`, 'product_id');
    if (itemGroupId) {
      addIdentityMapping(`gid:${itemGroupId}`, 'item_group_id');
    }
    if (isSpecificProductUrl(canonicalUrl)) {
      addIdentityMapping(`url:${canonicalUrl}`, 'canonical_url');
    }
    if (md.mpn && md.mpn.trim()) {
      addIdentityMapping(`mpn:${md.mpn.trim().toUpperCase()}`, 'mpn_sku');
    }
    if (Array.isArray(product.syncedVariants)) {
      for (const v of product.syncedVariants) {
        if (v.id && v.id.trim()) {
          addIdentityMapping(`vid:${v.id.trim()}`, 'variant_id');
        }
        if (v.mpn && v.mpn.trim()) {
          addIdentityMapping(`mpn:${v.mpn.trim().toUpperCase()}`, 'mpn_sku');
        }
      }
    }

    // Refresh website_sync_mappings
    stmts.push(
      this.db.prepare(`DELETE FROM website_sync_mappings WHERE product_id = ?`).bind(product.id)
    );
    if (product.websiteSyncMeta) {
      const meta = product.websiteSyncMeta;
      const syncGroupKey = meta.websiteItemGroupId
        ? `gid:${meta.websiteItemGroupId}`
        : meta.canonicalProductUrl && isSpecificProductUrl(meta.canonicalProductUrl)
          ? `url:${normalizeCanonicalProductUrl(meta.canonicalProductUrl)}`
          : `pid:${product.id}`;

      stmts.push(
        this.db
          .prepare(
            `INSERT INTO website_sync_mappings (
              website_group_key, product_id, website_item_group_id,
              website_primary_variant_id, canonical_product_url,
              match_method, variant_count, last_synced_at, feed_url, sync_meta_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(website_group_key) DO UPDATE SET
              product_id = excluded.product_id,
              website_item_group_id = excluded.website_item_group_id,
              website_primary_variant_id = excluded.website_primary_variant_id,
              canonical_product_url = excluded.canonical_product_url,
              match_method = excluded.match_method,
              variant_count = excluded.variant_count,
              last_synced_at = excluded.last_synced_at,
              feed_url = excluded.feed_url,
              sync_meta_json = excluded.sync_meta_json`
          )
          .bind(
            syncGroupKey,
            product.id,
            meta.websiteItemGroupId || '',
            meta.websitePrimaryVariantId || '',
            meta.canonicalProductUrl || canonicalUrl,
            meta.matchMethod || 'canonical_url',
            meta.variantCount ?? (product.syncedVariants?.length || 0),
            meta.lastSyncedAt || now,
            meta.feedUrl || '',
            JSON.stringify(meta)
          )
      );
    }

    return stmts;
  }

  private hydrateProductRow(
    row: D1ProductRow,
    variantsByProductId: Map<string, WebsiteVariant[]>
  ): ProductItem {
    const md = safeJsonParse<MerchantData>(row.merchant_data_json, {
      id: row.id,
      title: row.title,
      description: row.description,
      link: row.link,
      image_link: row.image_link,
      price: row.price,
      availability: (row.availability as MerchantData['availability']) || 'in_stock',
      brand: row.brand || 'Science of Gifts',
      gtin: row.gtin || '',
      mpn: row.mpn || '',
      identifier_exists: (row.identifier_exists as 'yes' | 'no') || 'no',
      item_group_id: row.item_group_id || '',
      google_product_category: row.google_product_category || '',
      product_type: row.product_type || '',
      color: row.color || '',
      size: row.size || '',
      material: row.material || '',
      gender: '',
      age_group: '',
      condition: 'new',
      custom_label_0: row.custom_label_0 || '',
      custom_label_1: row.custom_label_1 || '',
      custom_label_2: row.custom_label_2 || '',
      custom_label_3: row.custom_label_3 || '',
      custom_label_4: row.custom_label_4 || '',
    });

    // Ensure top-level indexed columns stay authoritative
    md.id = row.id;

    const evidence = safeJsonParse<EvidenceModel>(row.evidence_json, {
      sourceUrl: md.link,
      extractedAt: row.created_at,
      pageTitle: md.title,
      rawDescription: md.description,
      verifiedAttributes: { brand: md.brand },
      unresolvedAttributes: [],
      confidenceScores: {},
      variants: [],
      images: md.image_link ? [md.image_link] : [],
      userCorrections: {},
    });

    const giftIntelligence = safeJsonParse<GiftIntelligence>(row.gift_intelligence_json, {
      theme: md.custom_label_3 || '',
      subtheme: '',
      targetAudience: md.custom_label_0 ? [md.custom_label_0] : [],
      recipientPersonas: [],
      occasions: [],
      primaryGiftIntent: '',
      secondaryGiftIntents: [],
      searchConcepts: [],
    });

    const opt = safeJsonParse<StoredOptimizationData>(row.optimization_data_json, {
      titleCandidates: [],
      validation: { isValid: true, blockingErrors: [], warnings: [] },
      appliedSuggestions: [],
      history: [],
    });

    const websiteSyncMeta = row.website_sync_meta_json
      ? safeJsonParse<WebsiteSyncMetadata | undefined>(row.website_sync_meta_json, undefined)
      : undefined;

    const storedVariants = variantsByProductId.get(row.id);

    const product: ProductItem = {
      id: row.id,
      productGroup: row.product_group || undefined,
      productSubgroup: row.product_subgroup || undefined,
      status: (row.status as ProductItem['status']) || 'not_analyzed',
      evidence,
      merchantData: md,
      suggestedMerchantData: opt.suggestedMerchantData,
      giftIntelligence,
      suggestedGiftIntelligence: opt.suggestedGiftIntelligence,
      titleCandidates: opt.titleCandidates || [],
      selectedTitleCandidateId: opt.selectedTitleCandidateId,
      strategy: opt.strategy,
      audit: opt.audit,
      validation: opt.validation || { isValid: true, blockingErrors: [], warnings: [] },
      fieldProvenance: opt.fieldProvenance,
      fieldProvenanceDetails: opt.fieldProvenanceDetails,
      originalImported: opt.originalImported,
      lastOptimizationSummary: opt.lastOptimizationSummary,
      appliedSuggestions: opt.appliedSuggestions || [],
      history: opt.history || [],
      syncedVariants: storedVariants && storedVariants.length > 0 ? storedVariants : undefined,
      websiteSyncMeta,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    return product;
  }

  async loadCatalog(): Promise<ProductItem[]> {
    await this.ensureSchema();

    const [productsRes, variantsRes] = await this.db.batch([
      this.db.prepare(`SELECT * FROM products ORDER BY sort_order ASC, updated_at DESC`),
      this.db.prepare(`SELECT * FROM product_variants ORDER BY product_id ASC, sort_order ASC`),
    ]);

    const productRows = (productsRes.results || []) as unknown as D1ProductRow[];
    const variantRows = (variantsRes.results || []) as unknown as D1VariantRow[];

    const variantsByProductId = new Map<string, WebsiteVariant[]>();
    for (const vRow of variantRows) {
      const parsedVariant = safeJsonParse<WebsiteVariant | null>(vRow.variant_json, null);
      const variant: WebsiteVariant = parsedVariant || {
        id: vRow.variant_id,
        item_group_id: vRow.item_group_id || '',
        title: vRow.title,
        description: '',
        link: vRow.link,
        image_link: vRow.image_link || '',
        availability:
          (vRow.availability as WebsiteVariant['availability']) || 'in_stock',
        price: vRow.price,
        sale_price: vRow.sale_price || undefined,
        color: vRow.color || undefined,
        size: vRow.size || undefined,
        material: vRow.material || undefined,
        mpn: vRow.mpn || undefined,
        gtin: vRow.gtin || undefined,
        identifier_exists: (vRow.identifier_exists as 'yes' | 'no') || 'no',
      };
      if (!variantsByProductId.has(vRow.product_id)) {
        variantsByProductId.set(vRow.product_id, []);
      }
      variantsByProductId.get(vRow.product_id)!.push(variant);
    }

    const hydrated = productRows.map((row) => this.hydrateProductRow(row, variantsByProductId));

    // Re-evaluate validation and status dynamically across catalog
    return hydrated.map((item) => {
      const { status, validation } = computeProductStatus(item, hydrated);
      return {
        ...item,
        status: item.status === 'not_analyzed' ? 'not_analyzed' : status,
        validation,
      };
    });
  }

  async saveCatalog(items: readonly ProductItem[]): Promise<void> {
    await this.ensureSchema();
    const deduplicated = deduplicateCatalogItems(items);
    const claimedIdentityKeys = new Set<string>();

    const stmts: D1PreparedStatement[] = [];
    const currentIds = deduplicated.map((p) => p.id);

    if (currentIds.length === 0) {
      stmts.push(this.db.prepare(`DELETE FROM website_sync_mappings`));
      stmts.push(this.db.prepare(`DELETE FROM product_identity_mappings`));
      stmts.push(this.db.prepare(`DELETE FROM product_variants`));
      stmts.push(this.db.prepare(`DELETE FROM products`));
    } else {
      // Remove any products (and cascade/clean dependent rows) no longer in the catalog array
      const existingRes = await this.db
        .prepare(`SELECT id FROM products`)
        .all<{ id: string }>();
      const keepSet = new Set(currentIds);
      for (const row of existingRes.results || []) {
        if (!keepSet.has(row.id)) {
          stmts.push(
            this.db.prepare(`DELETE FROM website_sync_mappings WHERE product_id = ?`).bind(row.id)
          );
          stmts.push(
            this.db
              .prepare(`DELETE FROM product_identity_mappings WHERE product_id = ?`)
              .bind(row.id)
          );
          stmts.push(
            this.db.prepare(`DELETE FROM product_variants WHERE product_id = ?`).bind(row.id)
          );
          stmts.push(this.db.prepare(`DELETE FROM products WHERE id = ?`).bind(row.id));
        }
      }

      // Clear identity and sync mappings before rebuilding them cleanly in one batch
      stmts.push(this.db.prepare(`DELETE FROM product_identity_mappings`));
      stmts.push(this.db.prepare(`DELETE FROM website_sync_mappings`));

      deduplicated.forEach((product, idx) => {
        stmts.push(...this.buildUpsertStatementsForProduct(product, idx, claimedIdentityKeys));
      });
    }

    // Execute in safe D1 transaction chunks (D1 supports large batches, chunked at 250 statements for safety)
    const CHUNK_SIZE = 250;
    if (stmts.length <= CHUNK_SIZE) {
      await this.db.batch(stmts);
    } else {
      for (let i = 0; i < stmts.length; i += CHUNK_SIZE) {
        await this.db.batch(stmts.slice(i, i + CHUNK_SIZE));
      }
    }

    if (this.onDevSyncCallback) {
      this.onDevSyncCallback(deduplicated);
    }
  }

  async deleteProduct(id: string): Promise<void> {
    await this.ensureSchema();
    await this.db.batch([
      this.db.prepare(`DELETE FROM website_sync_mappings WHERE product_id = ?`).bind(id),
      this.db.prepare(`DELETE FROM product_identity_mappings WHERE product_id = ?`).bind(id),
      this.db.prepare(`DELETE FROM product_variants WHERE product_id = ?`).bind(id),
      this.db.prepare(`DELETE FROM products WHERE id = ?`).bind(id),
    ]);
    if (this.onDevSyncCallback) {
      const updated = await this.loadCatalog();
      this.onDevSyncCallback(updated);
    }
  }

  async loadStrategyConfig(): Promise<StrategyConfig> {
    await this.ensureSchema();
    const row = await this.db
      .prepare(`SELECT setting_value_json FROM catalog_settings WHERE setting_key = ?`)
      .bind('strategy_config')
      .first<{ setting_value_json: string }>();

    if (row && row.setting_value_json) {
      const parsed = safeJsonParse<StrategyConfig | null>(row.setting_value_json, null);
      if (parsed) return parsed;
    }

    await this.saveStrategyConfig(INITIAL_STRATEGY_CONFIG);
    return INITIAL_STRATEGY_CONFIG;
  }

  async saveStrategyConfig(config: StrategyConfig): Promise<void> {
    await this.ensureSchema();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO catalog_settings (setting_key, setting_value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET
           setting_value_json = excluded.setting_value_json,
           updated_at = excluded.updated_at`
      )
      .bind('strategy_config', JSON.stringify(config), now)
      .run();

    if (this.onDevStrategySyncCallback) {
      this.onDevStrategySyncCallback(config);
    }
  }

  async createCatalogBackup(
    label: string = 'snapshot',
    currentCatalog?: readonly ProductItem[]
  ): Promise<string> {
    await this.ensureSchema();
    const catalogToBackup = currentCatalog ?? (await this.loadCatalog());
    const now = new Date().toISOString();
    const safeTimestamp = now.replace(/[:.]/g, '-');
    const safeLabel =
      (label || 'snapshot')
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'snapshot';
    const randomSuffix = Math.random().toString(36).slice(2, 7);
    const backupId = `catalog-backup-${safeTimestamp}-${safeLabel}-${randomSuffix}`;

    await this.db
      .prepare(
        `INSERT INTO catalog_backups (backup_id, label, product_count, catalog_snapshot_json, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(backupId, safeLabel, catalogToBackup.length, JSON.stringify(catalogToBackup), now)
      .run();

    return `d1://catalog_backups/${backupId}`;
  }

  async listCatalogBackups(): Promise<
    Array<{ backupId: string; label: string; productCount: number; createdAt: string }>
  > {
    await this.ensureSchema();
    const res = await this.db
      .prepare(
        `SELECT backup_id, label, product_count, created_at FROM catalog_backups ORDER BY created_at DESC`
      )
      .all<{
        backup_id: string;
        label: string;
        product_count: number;
        created_at: string;
      }>();

    return (res.results || []).map((r) => ({
      backupId: r.backup_id,
      label: r.label,
      productCount: r.product_count,
      createdAt: r.created_at,
    }));
  }
}

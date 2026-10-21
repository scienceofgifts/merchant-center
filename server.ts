import express, { Request, Response } from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import {
  loadCatalog,
  saveCatalog,
  loadStrategyConfig,
  saveStrategyConfig,
} from './server/storage';
import { extractProductFromUrl } from './server/extractor';
import {
  generateProductStrategy,
  generateOptimizedFields,
  performAIAudit,
  runGranularAIOperation,
  optimizeAndApplyAll,
  fixSingleAuditIssue,
  fixAllSafeAuditIssues,
  inferProductGroupAndSubgroup,
  computeFieldProvenance,
} from './server/aiStrategist';
import { computeProductStatus } from './src/utils/validation';
import {
  generateMerchantCenterCsv,
  parseCsvText,
  convertParsedCsvToProducts,
} from './src/utils/csv';
import { ProductItem, MerchantData } from './src/types/feed';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ---------------- API ROUTES ---------------- //

// 1. Catalog Products CRUD
app.get('/api/products', (_req: Request, res: Response) => {
  try {
    const catalog = loadCatalog();
    res.json({ success: true, count: catalog.length, products: catalog });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/products/:id', (req: Request, res: Response) => {
  try {
    const catalog = loadCatalog();
    const item = catalog.find((p) => p.id === req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }
    res.json({ success: true, product: item });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/products', (req: Request, res: Response) => {
  try {
    const catalog = loadCatalog();
    const newProduct: ProductItem = req.body;
    const existingIndex = catalog.findIndex((p) => p.id === newProduct.id);

    const now = new Date().toISOString();
    newProduct.updatedAt = now;
    if (!newProduct.createdAt) newProduct.createdAt = now;

    if (existingIndex >= 0) {
      catalog[existingIndex] = newProduct;
    } else {
      catalog.unshift(newProduct);
    }

    const { status, validation } = computeProductStatus(newProduct, catalog);
    newProduct.status = status;
    newProduct.validation = validation;

    saveCatalog(catalog);
    res.json({ success: true, product: newProduct });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/products/:id', (req: Request, res: Response) => {
  try {
    const catalog = loadCatalog();
    const id = req.params.id;
    const index = catalog.findIndex((p) => p.id === id);
    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const prev = catalog[index];
    const incomingMd = req.body.merchantData || {};
    const userCorrections = { ...(prev.evidence?.userCorrections || {}) };
    const changedFields: string[] = [];

    // Track user-edited fields
    for (const key of ['size', 'color', 'material', 'title', 'description', 'google_product_category', 'product_type'] as const) {
      if (incomingMd[key] !== undefined && incomingMd[key] !== (prev.merchantData as any)[key]) {
        userCorrections[key] = incomingMd[key];
        changedFields.push(key);
      }
    }

    const history = [...(prev.history || [])];
    if (changedFields.length > 0) {
      history.unshift({
        timestamp: new Date().toISOString(),
        note: `User manual edit: ${changedFields.join(', ')}`,
        snapshot: { ...prev.merchantData },
      });
    }

    const updated: ProductItem = {
      ...prev,
      ...req.body,
      id: prev.id, // Strictly preserve existing ID
      merchantData: {
        ...prev.merchantData,
        ...incomingMd,
        id: prev.id, // Strictly preserve existing ID
        link: prev.merchantData.link, // Strictly preserve landing URL
      },
      evidence: {
        ...prev.evidence,
        ...(req.body.evidence || {}),
        userCorrections,
      },
      history,
      updatedAt: new Date().toISOString(),
    };

    // Recompute provenance accurately
    const provResult = computeFieldProvenance(updated, prev.merchantData);
    updated.fieldProvenance = provResult.fieldProvenance;
    updated.fieldProvenanceDetails = provResult.fieldProvenanceDetails;

    const { status, validation } = computeProductStatus(updated, catalog);
    updated.status = status;
    updated.validation = validation;

    catalog[index] = updated;
    saveCatalog(catalog);

    res.json({ success: true, product: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/products/:id', (req: Request, res: Response) => {
  try {
    let catalog = loadCatalog();
    const id = req.params.id;
    catalog = catalog.filter((p) => p.id !== id);
    saveCatalog(catalog);
    res.json({ success: true, message: 'Product deleted' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Batch URL Extraction
app.post('/api/products/batch-extract', async (req: Request, res: Response) => {
  try {
    const urls: string[] = req.body.urls || [];
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ success: false, error: 'No URLs provided' });
    }

    const catalog = loadCatalog();
    const results: Array<{ url: string; success: boolean; product?: ProductItem; error?: string }> = [];

    for (const rawUrl of urls) {
      const url = rawUrl.trim();
      if (!url) continue;
      try {
        const extracted = await extractProductFromUrl(url);
        // Replace or add to catalog
        const idx = catalog.findIndex((p) => p.id === extracted.id || p.merchantData.link === url);
        if (idx >= 0) {
          const existing = catalog[idx];
          // Preserve valid existing data if extracted was empty or failed
          const mergedMerchantData: MerchantData = {
            ...existing.merchantData,
            ...extracted.merchantData,
            id: existing.id, // Strictly preserve existing ID
            link: existing.merchantData.link,
            color: extracted.merchantData.color || existing.merchantData.color || '',
            size: extracted.merchantData.size || existing.merchantData.size || '',
            material: extracted.merchantData.material || existing.merchantData.material || '',
            gtin: extracted.merchantData.gtin || existing.merchantData.gtin || '',
            mpn: extracted.merchantData.mpn || existing.merchantData.mpn || '',
          };

          const mergedProduct: ProductItem = {
            ...existing,
            ...extracted,
            id: existing.id, // Strictly preserve existing ID
            merchantData: mergedMerchantData,
            evidence: {
              ...existing.evidence,
              ...extracted.evidence,
              userCorrections: existing.evidence?.userCorrections || {},
            },
            history: [
              {
                timestamp: new Date().toISOString(),
                note: 'Re-extracted from URL (preserved existing attributes and ID)',
                snapshot: { ...existing.merchantData },
              },
              ...(existing.history || []),
            ],
            updatedAt: new Date().toISOString(),
          };

          catalog[idx] = mergedProduct;
          results.push({ url, success: true, product: mergedProduct });
        } else {
          catalog.unshift(extracted);
          results.push({ url, success: true, product: extracted });
        }
      } catch (err: any) {
        results.push({ url, success: false, error: err.message });
      }
    }

    saveCatalog(catalog);
    res.json({ success: true, results, count: results.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. AI Operations: Strategy, Full Optimization, Quality Audit, Granular
app.post('/api/ai/strategy/:id', async (req: Request, res: Response) => {
  try {
    const catalog = loadCatalog();
    const config = loadStrategyConfig();
    const item = catalog.find((p) => p.id === req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const refresh = req.body.refresh === true;
    if (item.strategy && !refresh) {
      return res.json({ success: true, strategy: item.strategy, cached: true });
    }

    const strategy = await generateProductStrategy(item, config);
    item.strategy = strategy;
    item.updatedAt = new Date().toISOString();

    const { status, validation } = computeProductStatus(item, catalog);
    item.status = status;
    item.validation = validation;

    saveCatalog(catalog);
    res.json({ success: true, strategy, cached: false });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/ai/optimize/:id', async (req: Request, res: Response) => {
  try {
    const catalog = loadCatalog();
    const config = loadStrategyConfig();
    const item = catalog.find((p) => p.id === req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    // Ensure strategy exists first
    let strategy = item.strategy;
    if (!strategy) {
      strategy = await generateProductStrategy(item, config);
      item.strategy = strategy;
    }

    const { suggestedMerchantData, suggestedGiftIntelligence, titleCandidates } =
      await generateOptimizedFields(item, strategy, config);

    item.suggestedMerchantData = suggestedMerchantData;
    item.suggestedGiftIntelligence = suggestedGiftIntelligence;
    item.titleCandidates = titleCandidates;
    if (titleCandidates.length > 0) {
      item.selectedTitleCandidateId = titleCandidates[0].id;
    }

    item.updatedAt = new Date().toISOString();
    const { status, validation } = computeProductStatus(item, catalog);
    item.status = status;
    item.validation = validation;

    saveCatalog(catalog);
    res.json({
      success: true,
      suggestedMerchantData,
      suggestedGiftIntelligence,
      titleCandidates,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3b. 1-Click "Generate & Optimize" Complete Workflow: Evidence -> Strategy -> Generate Missing -> Optimize Existing -> Safe Fixes -> Provenance -> Re-Audit -> Save
const handleGenerateAndOptimize = async (req: Request, res: Response) => {
  try {
    const catalog = loadCatalog();
    const config = loadStrategyConfig();
    const item = catalog.find((p) => p.id === req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const result = await optimizeAndApplyAll(item, config);

    const { status, validation } = computeProductStatus(item, catalog);
    item.status = status;
    item.validation = validation;

    saveCatalog(catalog);
    res.json({
      success: true,
      product: item,
      beforeScore: result.beforeScore,
      afterScore: result.afterScore,
      appliedFields: result.appliedFields,
      autoFixedIssues: result.autoFixedIssues,
      remainingReviewCount: result.remainingReviewCount,
      generatedCount: result.generatedCount,
      optimizedCount: result.optimizedCount,
      verifiedCount: result.verifiedCount,
      fieldProvenance: item.fieldProvenance,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

app.post('/api/ai/optimize-and-apply/:id', handleGenerateAndOptimize);
app.post('/api/ai/generate-and-optimize/:id', handleGenerateAndOptimize);

// Recovery Endpoint: Reset Product to Original Imported Source Data
app.post('/api/ai/reset-to-original/:id', (req: Request, res: Response) => {
  try {
    const catalog = loadCatalog();
    const item = catalog.find((p) => p.id === req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const original = item.originalImported || { ...item.merchantData };

    item.merchantData = {
      ...item.merchantData,
      ...original,
      color: item.evidence.verifiedAttributes?.color || original.color || '',
      size: item.evidence.verifiedAttributes?.size || original.size || '',
      material: item.evidence.verifiedAttributes?.material || original.material || '',
    };

    item.strategy = undefined;
    item.suggestedMerchantData = undefined;
    item.suggestedGiftIntelligence = undefined;
    item.titleCandidates = [];
    item.selectedTitleCandidateId = undefined;

    const inferred = inferProductGroupAndSubgroup(
      item.merchantData.title,
      item.merchantData.description,
      item.evidence.sourceUrl
    );
    item.productGroup = inferred.productGroup;
    item.productSubgroup = inferred.productSubgroup;

    item.updatedAt = new Date().toISOString();
    const { status, validation } = computeProductStatus(item, catalog);
    item.status = status;
    item.validation = validation;

    saveCatalog(catalog);
    res.json({
      success: true,
      product: item,
      message: 'Successfully restored original imported data and cleared stale AI cache.',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/ai/audit/:id', async (req: Request, res: Response) => {
  try {
    const catalog = loadCatalog();
    const config = loadStrategyConfig();
    const item = catalog.find((p) => p.id === req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const audit = await performAIAudit(item, config);
    item.audit = audit;
    item.updatedAt = new Date().toISOString();

    const { status, validation } = computeProductStatus(item, catalog);
    item.status = status;
    item.validation = validation;

    saveCatalog(catalog);
    res.json({ success: true, audit });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3c. Apply Safe Fix for specific Audit Issue
app.post('/api/ai/fix-issue/:id', async (req: Request, res: Response) => {
  try {
    const catalog = loadCatalog();
    const config = loadStrategyConfig();
    const item = catalog.find((p) => p.id === req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const { issueId } = req.body;
    if (!issueId) {
      return res.status(400).json({ success: false, error: 'Missing issueId parameter' });
    }

    const result = await fixSingleAuditIssue(item, issueId, config);

    const { status, validation } = computeProductStatus(item, catalog);
    item.status = status;
    item.validation = validation;

    saveCatalog(catalog);
    res.json({
      success: true,
      product: item,
      fixedIssue: result.fixedIssue,
      appliedChanges: result.appliedChanges,
      message: result.message,
    });
  } catch (err: any) {
    console.error('Fix issue error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to fix issue' });
  }
});

// 3d. Fix All Safe Issues
app.post('/api/ai/fix-all-safe-issues/:id', async (req: Request, res: Response) => {
  try {
    const catalog = loadCatalog();
    const config = loadStrategyConfig();
    const item = catalog.find((p) => p.id === req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const result = await fixAllSafeAuditIssues(item, config);

    const { status, validation } = computeProductStatus(item, catalog);
    item.status = status;
    item.validation = validation;

    saveCatalog(catalog);
    res.json({
      success: true,
      product: item,
      fixedCount: result.fixedCount,
      fixedList: result.fixedList,
      appliedChanges: result.appliedChanges,
    });
  } catch (err: any) {
    console.error('Fix all safe issues error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to fix safe issues' });
  }
});

app.post('/api/ai/granular/:id', async (req: Request, res: Response) => {
  try {
    const catalog = loadCatalog();
    const config = loadStrategyConfig();
    const item = catalog.find((p) => p.id === req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const operation = req.body.operation;
    if (typeof operation === 'object' && operation.type === 'fix_issue') {
      const result = await fixSingleAuditIssue(item, operation.issueId, config);
      const { status, validation } = computeProductStatus(item, catalog);
      item.status = status;
      item.validation = validation;
      saveCatalog(catalog);
      return res.json({ success: true, product: item, result });
    }

    const result = await runGranularAIOperation(item, operation, config);

    if (result.suggestedMerchantData) {
      item.suggestedMerchantData = {
        ...item.suggestedMerchantData,
        ...result.suggestedMerchantData,
      };
    }
    if (result.suggestedGiftIntelligence) {
      item.suggestedGiftIntelligence = {
        ...item.suggestedGiftIntelligence,
        ...result.suggestedGiftIntelligence,
      };
    }
    if (result.titleCandidates && result.titleCandidates.length > 0) {
      item.titleCandidates = result.titleCandidates;
      item.selectedTitleCandidateId = result.titleCandidates[0].id;
    }

    item.updatedAt = new Date().toISOString();
    saveCatalog(catalog);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Accept AI Suggestions
app.post('/api/ai/apply-suggestions/:id', (req: Request, res: Response) => {
  try {
    const catalog = loadCatalog();
    const item = catalog.find((p) => p.id === req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const { fieldsToApply, note } = req.body;
    const now = new Date().toISOString();

    // Snapshot current state for history
    item.history.unshift({
      timestamp: now,
      note: note || `Applied AI suggestions: ${(fieldsToApply || ['all']).join(', ')}`,
      snapshot: { ...item.merchantData },
    });

    if (item.suggestedMerchantData) {
      if (!fieldsToApply || fieldsToApply.includes('all')) {
        item.merchantData = {
          ...item.merchantData,
          ...item.suggestedMerchantData,
        };
        item.suggestedMerchantData = undefined;
      } else {
        for (const field of fieldsToApply) {
          if ((item.suggestedMerchantData as any)[field] !== undefined) {
            (item.merchantData as any)[field] = (item.suggestedMerchantData as any)[field];
            delete (item.suggestedMerchantData as any)[field];
          }
        }
      }
    }

    if (item.suggestedGiftIntelligence) {
      item.giftIntelligence = {
        ...item.giftIntelligence,
        ...item.suggestedGiftIntelligence,
      };
      item.suggestedGiftIntelligence = undefined;
    }

    item.appliedSuggestions.push({
      timestamp: now,
      fields: fieldsToApply || ['all'],
      note: note || 'AI suggestions applied',
    });

    item.updatedAt = now;
    const { status, validation } = computeProductStatus(item, catalog);
    item.status = status;
    item.validation = validation;

    saveCatalog(catalog);
    res.json({ success: true, product: item });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Batch Catalog Actions
app.post('/api/products/batch-action', async (req: Request, res: Response) => {
  try {
    const { action, ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'No product IDs provided' });
    }

    let catalog = loadCatalog();
    const config = loadStrategyConfig();
    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    if (action === 'delete') {
      catalog = catalog.filter((p) => !ids.includes(p.id));
      saveCatalog(catalog);
      return res.json({ success: true, count: ids.length });
    }

    for (const id of ids) {
      const item = catalog.find((p) => p.id === id);
      if (!item) {
        results.push({ id, success: false, error: 'Item not found' });
        continue;
      }

      try {
        if (
          action === 'generate_and_optimize' ||
          action === 'optimize_and_apply' ||
          action === 'optimize_apply'
        ) {
          await optimizeAndApplyAll(item, config);
        } else if (action === 'analyze' || action === 'optimize') {
          const strategy = await generateProductStrategy(item, config);
          item.strategy = strategy;
          const { suggestedMerchantData, suggestedGiftIntelligence, titleCandidates } =
            await generateOptimizedFields(item, strategy, config);
          item.suggestedMerchantData = suggestedMerchantData;
          item.suggestedGiftIntelligence = suggestedGiftIntelligence;
          item.titleCandidates = titleCandidates;
          if (titleCandidates.length > 0) item.selectedTitleCandidateId = titleCandidates[0].id;
        }

        if (action === 'audit') {
          const audit = await performAIAudit(item, config);
          item.audit = audit;
        }

        if (action === 'approve_all') {
          if (item.suggestedMerchantData) {
            item.history.unshift({
              timestamp: new Date().toISOString(),
              note: 'Batch approved all suggestions',
              snapshot: { ...item.merchantData },
            });
            const priorMd = { ...item.merchantData };
            item.merchantData = { ...item.merchantData, ...item.suggestedMerchantData };
            item.suggestedMerchantData = undefined;
            const provResult = computeFieldProvenance(item, priorMd);
            item.fieldProvenance = provResult.fieldProvenance;
            item.fieldProvenanceDetails = provResult.fieldProvenanceDetails;
          }
          if (item.suggestedGiftIntelligence) {
            item.giftIntelligence = { ...item.giftIntelligence, ...item.suggestedGiftIntelligence };
            item.suggestedGiftIntelligence = undefined;
          }
        }

        const { status, validation } = computeProductStatus(item, catalog);
        item.status = status;
        item.validation = validation;
        item.updatedAt = new Date().toISOString();
        results.push({ id, success: true });
      } catch (err: any) {
        results.push({ id, success: false, error: err.message });
      }
    }

    saveCatalog(catalog);
    res.json({ success: true, results });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Strategy Configuration Area
app.get('/api/strategy-config', (_req: Request, res: Response) => {
  try {
    const config = loadStrategyConfig();
    res.json({ success: true, config });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/strategy-config', (req: Request, res: Response) => {
  try {
    saveStrategyConfig(req.body);
    res.json({ success: true, config: req.body });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. CSV Import & Export
app.post('/api/import-csv', (req: Request, res: Response) => {
  try {
    const { csvText, mode } = req.body;
    if (!csvText) {
      return res.status(400).json({ success: false, error: 'CSV content missing' });
    }

    const parsedRows = parseCsvText(csvText);
    if (parsedRows.length === 0) {
      return res.status(400).json({ success: false, error: 'Could not parse CSV or file is empty' });
    }

    const importedProducts = convertParsedCsvToProducts(parsedRows);
    let catalog = loadCatalog();

    if (mode === 'replace') {
      catalog = importedProducts;
    } else {
      // Append or merge
      for (const imp of importedProducts) {
        const existingIdx = catalog.findIndex((p) => p.id === imp.id || p.merchantData.link === imp.merchantData.link);
        if (existingIdx >= 0) {
          catalog[existingIdx] = {
            ...catalog[existingIdx],
            merchantData: imp.merchantData,
            originalImported: { ...imp.merchantData },
            updatedAt: new Date().toISOString(),
          };
        } else {
          catalog.push(imp);
        }
      }
    }

    saveCatalog(catalog);
    res.json({ success: true, count: importedProducts.length, catalogCount: catalog.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/export-csv', (_req: Request, res: Response) => {
  try {
    const catalog = loadCatalog();
    const csvData = generateMerchantCenterCsv(catalog);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="science_of_gifts_merchant_feed.csv"');
    res.send(csvData);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Full Backup & Restore
app.get('/api/backup', (_req: Request, res: Response) => {
  try {
    const catalog = loadCatalog();
    const strategy = loadStrategyConfig();
    res.setHeader('Content-Disposition', 'attachment; filename="science_of_gifts_backup.json"');
    res.json({ catalog, strategy, exportedAt: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/restore', (req: Request, res: Response) => {
  try {
    const { catalog, strategy } = req.body;
    if (catalog && Array.isArray(catalog)) saveCatalog(catalog);
    if (strategy) saveStrategyConfig(strategy);
    res.json({ success: true, message: 'Data restored successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------- SERVER & VITE INTEGRATION ---------------- //

async function startServer() {
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Science of Gifts Feed Optimizer] Server running at http://localhost:${PORT}`);
  });
}

startServer();

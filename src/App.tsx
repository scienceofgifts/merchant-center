import React, { useState, useEffect, useCallback } from 'react';
import { ProductItem, StrategyConfig } from './types/feed';
import { INITIAL_STRATEGY_CONFIG } from './utils/taxonomy';
import { Header } from './components/Header';
import { BulkWorkspace } from './components/BulkWorkspace';
import { ProductWorkspace } from './components/ProductWorkspace';
import { BatchUrlIngester } from './components/BatchUrlIngester';
import { CsvImportExportModal } from './components/CsvImportExportModal';
import { StrategyConfigModal } from './components/StrategyConfigModal';
import { BulkProgressModal } from './components/BulkProgressModal';
import { useBulkOptimizer } from './hooks/useBulkOptimizer';
import { Loader2, AlertCircle } from 'lucide-react';

export default function App() {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [strategyConfig, setStrategyConfig] = useState<StrategyConfig>(INITIAL_STRATEGY_CONFIG);
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null);
  const [isBatchUrlModalOpen, setIsBatchUrlModalOpen] = useState(false);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [csvModalTab, setCsvModalTab] = useState<'import' | 'export'>('export');
  const [isStrategyModalOpen, setIsStrategyModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Fetch Catalog & Config
  const loadInitialData = useCallback(async () => {
    setIsLoading(true);
    setGlobalError(null);
    try {
      // 1. Fetch Products
      const prodRes = await fetch('/api/products');
      const prodData = await prodRes.json();
      if (prodData.success) {
        setProducts(prodData.products);
      }

      // 2. Fetch Strategy Config
      const stratRes = await fetch('/api/strategy-config');
      const stratData = await stratRes.json();
      if (stratData.success && stratData.config) {
        setStrategyConfig(stratData.config);
      }
    } catch (err: any) {
      console.error('Failed to load initial data:', err);
      setGlobalError('Could not connect to backend server. Make sure API is running.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Keep selectedProduct in sync with updated list ONLY if user is still viewing the target product
  const syncSelectedProduct = (updatedList: ProductItem[], targetId: string) => {
    setSelectedProduct((prev) => {
      if (prev && prev.id === targetId) {
        const found = updatedList.find((p) => p.id === targetId);
        return found || prev;
      }
      return prev;
    });
  };

  // Reset Product to Original Source Data
  const handleResetToOriginal = async (id: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/ai/reset-to-original/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (data.success && data.product) {
        setProducts((prev) =>
          prev.map((p) => (p.id === data.product.id ? data.product : p))
        );
        setSelectedProduct((prev) => (prev && prev.id === id ? data.product : prev));
      }
    } catch (err: any) {
      console.error('Reset to original error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Immediate Product Update Callback for Sequential Bulk Optimization Queue
  const handleBulkProductUpdated = useCallback((updatedProduct: ProductItem) => {
    setProducts((prev) =>
      prev.map((p) => (p.id === updatedProduct.id ? updatedProduct : p))
    );
    setSelectedProduct((prev) => (prev && prev.id === updatedProduct.id ? updatedProduct : prev));
  }, []);

  const bulkOptimizer = useBulkOptimizer({
    onProductUpdated: handleBulkProductUpdated,
  });

  // Product Save
  const handleSaveProduct = async (updatedProduct: ProductItem) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/products/${updatedProduct.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedProduct),
      });
      const data = await response.json();
      if (data.success) {
        setProducts((prev) =>
          prev.map((p) => (p.id === data.product.id ? data.product : p))
        );
        setSelectedProduct(data.product);
      }
    } catch (err: any) {
      console.error('Save product error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Delete Single Product
  const handleDeleteProduct = async (id: string) => {
    if (!confirm('Are you sure you want to delete this product from the feed?')) return;
    setIsLoading(true);
    try {
      const response = await fetch(`/api/products/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (data.success) {
        setProducts((prev) => prev.filter((p) => p.id !== id));
        if (selectedProduct?.id === id) setSelectedProduct(null);
      }
    } catch (err: any) {
      console.error('Delete product error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // AI Strategy
  const handleRunStrategy = async (id: string, refresh = false) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/ai/strategy/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh }),
      });
      const data = await response.json();
      if (data.success) {
        // Refresh catalog to get updated product
        const catalogRes = await fetch('/api/products');
        const catalogData = await catalogRes.json();
        if (catalogData.success) {
          setProducts(catalogData.products);
          syncSelectedProduct(catalogData.products, id);
        }
      }
    } catch (err: any) {
      console.error('Strategy run error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // AI Full Optimize
  const handleRunOptimize = async (id: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/ai/optimize/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (data.success) {
        const catalogRes = await fetch('/api/products');
        const catalogData = await catalogRes.json();
        if (catalogData.success) {
          setProducts(catalogData.products);
          syncSelectedProduct(catalogData.products, id);
        }
      }
    } catch (err: any) {
      console.error('Optimize run error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // 1-Click "Optimize & Apply All" Workflow
  const handleRunOptimizeAndApply = async (id: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/ai/optimize-and-apply/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (data.success) {
        const catalogRes = await fetch('/api/products');
        const catalogData = await catalogRes.json();
        if (catalogData.success) {
          setProducts(catalogData.products);
          syncSelectedProduct(catalogData.products, id);
        }
      }
    } catch (err: any) {
      console.error('Optimize & apply error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // AI Quality Audit
  const handleRunAudit = async (id: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/ai/audit/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (data.success) {
        const catalogRes = await fetch('/api/products');
        const catalogData = await catalogRes.json();
        if (catalogData.success) {
          setProducts(catalogData.products);
          syncSelectedProduct(catalogData.products, id);
        }
      }
    } catch (err: any) {
      console.error('Audit run error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // AI Fix Single Audit Issue
  const handleFixIssue = async (id: string, issueId: string) => {
    try {
      const response = await fetch(`/api/ai/fix-issue/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId }),
      });
      const data = await response.json();
      if (data.success && data.product) {
        setProducts((prev) =>
          prev.map((p) => (p.id === data.product.id ? data.product : p))
        );
        setSelectedProduct(data.product);
        return { success: true, product: data.product, appliedChanges: data.appliedChanges, message: data.message };
      } else {
        throw new Error(data.error || 'Failed to fix issue');
      }
    } catch (err: any) {
      console.error('Fix issue error:', err);
      throw err;
    }
  };

  // AI Fix All Safe Issues
  const handleFixAllSafeIssues = async (id: string) => {
    try {
      const response = await fetch(`/api/ai/fix-all-safe-issues/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (data.success && data.product) {
        setProducts((prev) =>
          prev.map((p) => (p.id === data.product.id ? data.product : p))
        );
        setSelectedProduct(data.product);
        return { success: true, product: data.product, fixedCount: data.fixedCount, fixedList: data.fixedList };
      } else {
        throw new Error(data.error || 'Failed to fix safe issues');
      }
    } catch (err: any) {
      console.error('Fix all safe issues error:', err);
      throw err;
    }
  };

  // AI Granular Operation
  const handleRunGranular = async (id: string, operation: any) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/ai/granular/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation }),
      });
      const data = await response.json();
      if (data.success) {
        const catalogRes = await fetch('/api/products');
        const catalogData = await catalogRes.json();
        if (catalogData.success) {
          setProducts(catalogData.products);
          syncSelectedProduct(catalogData.products, id);
        }
      }
    } catch (err: any) {
      console.error('Granular run error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Apply Suggestions
  const handleApplySuggestions = async (id: string, fields?: string[], note?: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/ai/apply-suggestions/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldsToApply: fields, note }),
      });
      const data = await response.json();
      if (data.success) {
        setProducts((prev) =>
          prev.map((p) => (p.id === data.product.id ? data.product : p))
        );
        setSelectedProduct(data.product);
      }
    } catch (err: any) {
      console.error('Apply suggestions error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Batch Action
  const handleBatchAction = async (
    action: 'optimize_and_apply' | 'optimize' | 'audit' | 'approve_all' | 'delete',
    ids: string[]
  ) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/products/batch-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids }),
      });
      const data = await response.json();
      if (data.success) {
        const catalogRes = await fetch('/api/products');
        const catalogData = await catalogRes.json();
        if (catalogData.success) {
          setProducts(catalogData.products);
          if (selectedProduct) {
            syncSelectedProduct(catalogData.products, selectedProduct.id);
          }
        }
      }
    } catch (err: any) {
      console.error('Batch action error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Save Strategy Config
  const handleSaveStrategyConfig = async (updatedConfig: StrategyConfig) => {
    try {
      const response = await fetch('/api/strategy-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });
      const data = await response.json();
      if (data.success) {
        setStrategyConfig(data.config);
      }
    } catch (err) {
      console.error('Save strategy config error:', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Navigation Header */}
      <Header
        products={products}
        modelName={strategyConfig.geminiModel || 'gemini-3.5-flash-lite'}
        onOpenBatchUrlModal={() => setIsBatchUrlModalOpen(true)}
        onOpenCsvModal={(tab = 'export') => {
          setCsvModalTab(tab);
          setIsCsvModalOpen(true);
        }}
        onOpenStrategyModal={() => setIsStrategyModalOpen(true)}
        onRefreshCatalog={loadInitialData}
        isLoading={isLoading}
      />

      {/* Global Error Banner */}
      {globalError && (
        <div className="bg-rose-950/90 border-b border-rose-800 text-rose-200 text-xs px-6 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400" />
            <span>{globalError}</span>
          </div>
          <button
            onClick={() => setGlobalError(null)}
            className="text-rose-400 hover:text-white font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Catalog Bulk Workspace */}
      <main className="flex-1 pb-16">
        <BulkWorkspace
          products={products}
          config={strategyConfig}
          onSelectProduct={(p) => setSelectedProduct(p)}
          onRunBatchAction={handleBatchAction}
          onStartBulkOptimize={(ids) => bulkOptimizer.startBulkOptimization(ids, products)}
          onOptimizeSingle={(id) => handleRunOptimizeAndApply(id)}
          onAuditSingle={(id) => handleRunAudit(id)}
          onDeleteSingle={(id) => handleDeleteProduct(id)}
          isLoading={isLoading || bulkOptimizer.isRunning}
        />
      </main>

      {/* Sequential Bulk Optimization Progress & Summary Modal */}
      <BulkProgressModal
        isOpen={bulkOptimizer.isModalOpen}
        items={bulkOptimizer.queueItems}
        isRunning={bulkOptimizer.isRunning}
        isPaused={bulkOptimizer.isPaused}
        isCancelled={bulkOptimizer.isCancelled}
        currentIndex={bulkOptimizer.currentIndex}
        summary={bulkOptimizer.summary}
        onPause={bulkOptimizer.pause}
        onResume={bulkOptimizer.resume}
        onCancel={bulkOptimizer.cancel}
        onRetryFailed={bulkOptimizer.retryFailed}
        onClose={bulkOptimizer.closeModal}
      />

      {/* Deep Product Workspace Modal */}
      {selectedProduct && (
        <ProductWorkspace
          product={selectedProduct}
          config={strategyConfig}
          onClose={() => setSelectedProduct(null)}
          onSave={handleSaveProduct}
          onRunStrategy={handleRunStrategy}
          onRunOptimize={handleRunOptimize}
          onRunOptimizeAndApply={handleRunOptimizeAndApply}
          onRunAudit={handleRunAudit}
          onRunGranular={handleRunGranular}
          onFixIssue={handleFixIssue}
          onFixAllSafeIssues={handleFixAllSafeIssues}
          onApplySuggestions={handleApplySuggestions}
          onResetToOriginal={handleResetToOriginal}
          isLoading={isLoading}
        />
      )}

      {/* Batch URL Ingestion Modal */}
      <BatchUrlIngester
        isOpen={isBatchUrlModalOpen}
        onClose={() => setIsBatchUrlModalOpen(false)}
        onBatchIngested={(newProducts) => {
          setProducts((prev) => {
            const combined = [...newProducts];
            for (const existing of prev) {
              if (!combined.some((c) => c.id === existing.id)) {
                combined.push(existing);
              }
            }
            return combined;
          });
        }}
      />

      {/* CSV Import & Export Modal */}
      <CsvImportExportModal
        isOpen={isCsvModalOpen}
        initialTab={csvModalTab}
        onClose={() => setIsCsvModalOpen(false)}
        products={products}
        onImportComplete={() => loadInitialData()}
      />

      {/* Strategy & Taxonomy Config Modal */}
      <StrategyConfigModal
        isOpen={isStrategyModalOpen}
        onClose={() => setIsStrategyModalOpen(false)}
        config={strategyConfig}
        onSaveConfig={handleSaveStrategyConfig}
      />
    </div>
  );
}

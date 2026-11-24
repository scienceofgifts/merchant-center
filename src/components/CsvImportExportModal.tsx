import React, { useEffect, useState } from 'react';
import {
  X,
  FileSpreadsheet,
  Download,
  Upload,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileText,
  Copy,
  Check,
  Eye,
  ShieldCheck,
} from 'lucide-react';
import {
  ProductItem,
  CsvImportMode,
  CsvImportPreview,
  CsvImportApplySummary,
} from '../types/feed';
import { generateMerchantCenterCsv, validateExportedFeedRows } from '../utils/csv';

interface CsvImportExportModalProps {
  isOpen: boolean;
  initialTab?: 'import' | 'export';
  onClose: () => void;
  products: ProductItem[];
  onImportComplete: (count: number) => void;
}

export const CsvImportExportModal: React.FC<CsvImportExportModalProps> = ({
  isOpen,
  initialTab = 'export',
  onClose,
  products,
  onImportComplete,
}) => {
  const [activeTab, setActiveTab] = useState<'import' | 'export'>(initialTab);
  const [csvInput, setCsvInput] = useState('');
  const [importMode, setImportMode] = useState<CsvImportMode>('merge');
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewData, setPreviewData] = useState<CsvImportPreview | null>(null);
  const [confirmedModeAction, setConfirmedModeAction] = useState(false);
  const [importStats, setImportStats] = useState<{
    count?: number;
    summary?: CsvImportApplySummary;
    error?: string;
  } | null>(null);
  const [copiedCsv, setCopiedCsv] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setImportStats(null);
      setPreviewData(null);
      setConfirmedModeAction(false);
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  // Validation before export calculation
  const totalProducts = products.length;
  const blockingItems = products.filter((p) => !p.validation.isValid);
  const warningItems = products.filter((p) => p.validation.isValid && p.validation.warnings.length > 0);
  const readyItems = products.filter((p) => p.validation.isValid && p.validation.warnings.length === 0);
  const exportSummary = validateExportedFeedRows(products);

  const canExport = totalProducts > 0;
  const requiresConfirmation = importMode === 'update' || importMode === 'replace';
  const hasCurrentPreview = previewData !== null && previewData.mode === importMode;
  const canApplyImport =
    !isProcessing &&
    !isPreviewing &&
    csvInput.trim().length > 0 &&
    (!requiresConfirmation || (hasCurrentPreview && confirmedModeAction));

  const handleCsvInputChange = (value: string) => {
    setCsvInput(value);
    setPreviewData(null);
    setConfirmedModeAction(false);
    setImportStats(null);
  };

  const handleModeChange = (nextMode: CsvImportMode) => {
    setImportMode(nextMode);
    setPreviewData(null);
    setConfirmedModeAction(false);
    setImportStats(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = (event.target?.result as string) || '';
      handleCsvInputChange(text);
    };
    reader.readAsText(file);
  };

  const handlePreviewImport = async () => {
    if (!csvInput.trim()) return;
    setIsPreviewing(true);
    setImportStats(null);
    setConfirmedModeAction(false);

    try {
      const response = await fetch('/api/import-csv/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText: csvInput, mode: importMode }),
      });

      const data = await response.json();
      if (data.success && data.preview) {
        setPreviewData(data.preview);
      } else {
        setPreviewData(null);
        setImportStats({ error: data.error || 'Could not generate CSV import preview' });
      }
    } catch (err: any) {
      setPreviewData(null);
      setImportStats({ error: err.message || 'Preview request failed' });
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleRunImport = async () => {
    if (!csvInput.trim()) return;
    if (requiresConfirmation && (!hasCurrentPreview || !confirmedModeAction)) {
      setImportStats({
        error: `Please preview the CSV and confirm before applying "${importMode}" mode.`,
      });
      return;
    }

    setIsProcessing(true);
    setImportStats(null);

    try {
      const response = await fetch('/api/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csvText: csvInput,
          mode: importMode,
          confirmed: requiresConfirmation ? confirmedModeAction : true,
        }),
      });

      const data = await response.json();
      if (data.success) {
        setImportStats({ count: data.count, summary: data.summary });
        if (data.preview) {
          setPreviewData(data.preview);
        }
        setConfirmedModeAction(false);
        onImportComplete(data.count);
      } else {
        setImportStats({ error: data.error || 'Import failed' });
      }
    } catch (err: any) {
      setImportStats({ error: err.message });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadCsv = () => {
    window.location.href = '/api/export-csv';
  };

  const handleDownloadRssXml = () => {
    window.location.href = '/api/export-rss';
  };

  const handleCopyCsvToClipboard = () => {
    const csv = generateMerchantCenterCsv(products);
    navigator.clipboard.writeText(csv);
    setCopiedCsv(true);
    setTimeout(() => setCopiedCsv(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600/20 text-emerald-400 flex items-center justify-center">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                Merchant Center Feed Export & CSV Manager
              </h3>
              <p className="text-xs text-slate-400">
                Expands catalog designs into individual purchasable variant rows for Google Merchant Center
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center gap-2 px-6 pt-3 border-b border-slate-800 bg-slate-900/50">
          <button
            onClick={() => setActiveTab('export')}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border-b-2 transition ${
              activeTab === 'export'
                ? 'border-emerald-500 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Pre-Export Validation & Download</span>
          </button>

          <button
            onClick={() => setActiveTab('import')}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border-b-2 transition ${
              activeTab === 'import'
                ? 'border-emerald-500 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import Existing Merchant Center CSV</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {activeTab === 'export' && (
            <div className="space-y-4">
              {/* Validation Overview Card */}
              <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                    Deterministic Feed Compliance & Variant Expansion Check
                  </h4>
                  {blockingItems.length === 0 && exportSummary.isValid ? (
                    <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                      <CheckCircle2 className="w-3.5 h-3.5" /> READY FOR EXPORT
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-950/80 text-rose-300 border border-rose-800">
                      <XCircle className="w-3.5 h-3.5" /> EXPORT BLOCKED (
                      {blockingItems.length + exportSummary.errors.length} Issues)
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-indigo-950/30 border border-indigo-900/40">
                    <span className="text-[11px] text-indigo-300 block font-medium">
                      Exported Variant Rows
                    </span>
                    <span className="text-base font-bold text-indigo-200">
                      {exportSummary.totalExportedVariantRows}
                    </span>
                    <span className="text-[11px] text-slate-400 block mt-0.5">
                      from {exportSummary.totalCatalogDesigns} catalog designs
                    </span>
                  </div>

                  <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-900/40">
                    <span className="text-[11px] text-emerald-400 block font-medium">100% Compliant</span>
                    <span className="text-base font-bold text-emerald-200">{readyItems.length}</span>
                    <span className="text-[11px] text-slate-400 block mt-0.5">Zero warnings or errors</span>
                  </div>

                  <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-900/40">
                    <span className="text-[11px] text-amber-400 block font-medium">Warnings</span>
                    <span className="text-base font-bold text-amber-200">{warningItems.length}</span>
                    <span className="text-[11px] text-slate-400 block mt-0.5">Exportable with cautions</span>
                  </div>

                  <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-900/40">
                    <span className="text-[11px] text-rose-400 block font-medium">Blocking Errors</span>
                    <span className="text-base font-bold text-rose-200">
                      {blockingItems.length + exportSummary.errors.length}
                    </span>
                    <span className="text-[11px] text-slate-400 block mt-0.5">Must be fixed before live feed</span>
                  </div>
                </div>

                {/* Blocking Issues List */}
                {(blockingItems.length > 0 || exportSummary.errors.length > 0) && (
                  <div className="mt-3 p-3 rounded-lg bg-rose-950/40 border border-rose-900/60 space-y-1.5 max-h-40 overflow-y-auto">
                    <span className="text-xs font-semibold text-rose-300 block">
                      Blocking Feed Errors:
                    </span>
                    {blockingItems.map((item) => (
                      <div key={item.id} className="text-[11px] text-rose-200">
                        <span className="font-mono font-bold">{item.id}:</span>{' '}
                        {item.validation.blockingErrors.join(' • ')}
                      </div>
                    ))}
                    {exportSummary.errors.map((err, idx) => (
                      <div key={idx} className="text-[11px] text-rose-200">
                        • {err}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* CSV Columns Included */}
              <div className="p-3.5 rounded-lg bg-slate-950/50 border border-slate-800 text-xs space-y-2">
                <span className="font-semibold text-slate-300 block">
                  Included Google Merchant Center Standard Columns:
                </span>
                <p className="text-[11px] text-slate-400 font-mono leading-relaxed">
                  id, title, description, link, image_link, additional_image_link, availability, price, sale_price,
                  google_product_category, product_type, brand, gtin, mpn, identifier_exists, item_group_id, color,
                  size, material, pattern, gender, age_group, condition, size_type, custom_label_0, custom_label_1,
                  custom_label_2, custom_label_3, custom_label_4
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleCopyCsvToClipboard}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition"
                >
                  {copiedCsv ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedCsv ? 'Copied CSV!' : 'Copy CSV Text'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadRssXml}
                  disabled={!canExport}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-indigo-200 bg-indigo-950/90 hover:bg-indigo-900 border border-indigo-700/80 rounded-lg shadow-sm transition disabled:opacity-50"
                >
                  <FileText className="w-4 h-4 text-indigo-400" />
                  <span>Download RSS/XML Feed</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadCsv}
                  disabled={!canExport}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg shadow-sm transition disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  <span>Download science_of_gifts_feed.csv</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'import' && (
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300 block">
                  Select Merchant Center CSV / TSV File or Paste Raw Content
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    accept=".csv,.tsv,.txt"
                    onChange={handleFileUpload}
                    className="text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700"
                  />
                </div>
              </div>

              <div>
                <textarea
                  value={csvInput}
                  onChange={(e) => handleCsvInputChange(e.target.value)}
                  placeholder="Paste RFC 4180 CSV text with headers (id, item_group_id, title, description, link, price, size, color, ...)"
                  rows={6}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 p-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500 transition"
                />
              </div>

              {/* Import Mode Selector */}
              <div className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 space-y-2 text-xs">
                <span className="text-slate-300 font-semibold block">Import Mode</span>
                <div className="space-y-2">
                  <label className="flex items-start gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="importMode"
                      value="merge"
                      checked={importMode === 'merge'}
                      onChange={() => handleModeChange('merge')}
                      className="mt-0.5"
                    />
                    <span>
                      <strong className="text-emerald-300">Merge (Default, Non-Destructive):</strong> Groups
                      variant rows into product designs, adds new products &amp; missing variants, fills only
                      blank fields, and preserves all existing products, edits, custom labels, and optimization data.
                    </span>
                  </label>

                  <label className="flex items-start gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="importMode"
                      value="update"
                      checked={importMode === 'update'}
                      onChange={() => handleModeChange('update')}
                      className="mt-0.5"
                    />
                    <span>
                      <strong className="text-amber-300">Update Matched Facts (Preview + Confirmation):</strong>{' '}
                      Keeps all existing products and manual edits/titles/descriptions/custom labels, while
                      refreshing non-blank variant attributes (price, availability, size, color, images) from the CSV.
                    </span>
                  </label>

                  <label className="flex items-start gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="importMode"
                      value="replace"
                      checked={importMode === 'replace'}
                      onChange={() => handleModeChange('replace')}
                      className="mt-0.5"
                    />
                    <span>
                      <strong className="text-rose-300">Replace Entire Catalog (Preview + Confirmation):</strong>{' '}
                      Creates an automatic backup first, then replaces the catalog with the grouped products from
                      this CSV.
                    </span>
                  </label>
                </div>
              </div>

              {/* Import Preview Panel */}
              {hasCurrentPreview && previewData && (
                <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-700/80 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span>Deterministic CSV Import Preview ({previewData.mode.toUpperCase()} Mode)</span>
                    </h4>
                    <span className="text-[11px] text-slate-400">
                      Catalog: {previewData.existingCatalogCount} &rarr;{' '}
                      <strong className="text-slate-200">{previewData.resultingProductCount} products</strong> (
                      {previewData.resultingVariantCount} variants)
                    </span>
                  </div>

                  {/* 6 Required Preview Metrics */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">Total CSV Rows</span>
                      <span className="text-sm font-bold text-slate-100">{previewData.totalCsvRows}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-900/50">
                      <span className="text-[10px] text-indigo-300 block">Unique Products</span>
                      <span className="text-sm font-bold text-indigo-200">{previewData.uniqueProducts}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-cyan-950/40 border border-cyan-900/50">
                      <span className="text-[10px] text-cyan-300 block">Variants</span>
                      <span className="text-sm font-bold text-cyan-200">{previewData.totalVariants}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-900/50">
                      <span className="text-[10px] text-emerald-300 block">New Products</span>
                      <span className="text-sm font-bold text-emerald-200">{previewData.newProductsCount}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-sky-950/40 border border-sky-900/50">
                      <span className="text-[10px] text-sky-300 block">Matched Existing</span>
                      <span className="text-sm font-bold text-sky-200">{previewData.matchedExistingCount}</span>
                    </div>
                    <div
                      className={`p-2.5 rounded-lg border ${
                        previewData.conflictsCount > 0
                          ? 'bg-amber-950/50 border-amber-800/70'
                          : 'bg-slate-900 border-slate-800'
                      }`}
                    >
                      <span
                        className={`text-[10px] block ${
                          previewData.conflictsCount > 0 ? 'text-amber-300' : 'text-slate-400'
                        }`}
                      >
                        Conflicts
                      </span>
                      <span
                        className={`text-sm font-bold ${
                          previewData.conflictsCount > 0 ? 'text-amber-200' : 'text-slate-200'
                        }`}
                      >
                        {previewData.conflictsCount}
                      </span>
                    </div>
                  </div>

                  {previewData.duplicateVariantRowsDeduplicated > 0 && (
                    <p className="text-[11px] text-slate-400">
                      Deduplicated {previewData.duplicateVariantRowsDeduplicated} duplicate variant row(s) inside
                      the CSV by stable variant ID.
                    </p>
                  )}

                  {previewData.mode === 'replace' && previewData.existingCatalogCount > 0 && (
                    <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/70 text-[11px] text-rose-200 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>
                        Replace mode will replace all {previewData.existingCatalogCount} existing catalog products
                        with {previewData.uniqueProducts} grouped CSV products. A timestamped backup of{' '}
                        <code className="font-mono">data/catalog.json</code> will be saved automatically first.
                      </span>
                    </div>
                  )}

                  {/* Conflicts List */}
                  {previewData.conflicts.length > 0 && (
                    <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-800/60 space-y-1.5 max-h-36 overflow-y-auto">
                      <span className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>
                          Conflicts Detected ({previewData.conflicts.length}) — Preserved Safely as Separate
                          Records
                        </span>
                      </span>
                      {previewData.conflicts.map((conflict, idx) => (
                        <div key={idx} className="text-[11px] text-amber-200/90 leading-snug">
                          <span className="font-mono font-semibold text-amber-100">[{conflict.type}]</span>{' '}
                          {conflict.message}{' '}
                          <span className="text-slate-300">({conflict.resolution})</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Matched & New Products Sample */}
                  {(previewData.matchedProducts.length > 0 || previewData.newProducts.length > 0) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                      {previewData.matchedProducts.length > 0 && (
                        <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 max-h-32 overflow-y-auto space-y-1">
                          <span className="font-semibold text-sky-300 block">
                            Matched Existing Products ({previewData.matchedProducts.length})
                          </span>
                          {previewData.matchedProducts.slice(0, 25).map((m) => (
                            <div key={m.catalogProductId} className="text-slate-300 truncate">
                              <span className="font-mono text-slate-400">{m.catalogProductId}</span> &bull;{' '}
                              {m.existingVariantCount}&rarr;{m.resultingVariantCount} variants ({m.matchMethod})
                              {!m.willModify && <span className="text-emerald-400 ml-1">(unchanged)</span>}
                            </div>
                          ))}
                          {previewData.matchedProducts.length > 25 && (
                            <div className="text-slate-500">
                              +{previewData.matchedProducts.length - 25} more matched products...
                            </div>
                          )}
                        </div>
                      )}

                      {previewData.newProducts.length > 0 && (
                        <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 max-h-32 overflow-y-auto space-y-1">
                          <span className="font-semibold text-emerald-300 block">
                            New Products to Add ({previewData.newProducts.length})
                          </span>
                          {previewData.newProducts.slice(0, 25).map((p) => (
                            <div key={p.proposedId} className="text-slate-300 truncate">
                              <span className="font-mono text-slate-400">{p.proposedId}</span> &bull;{' '}
                              {p.variantCount} variant{p.variantCount === 1 ? '' : 's'} — {p.title}
                            </div>
                          ))}
                          {previewData.newProducts.length > 25 && (
                            <div className="text-slate-500">
                              +{previewData.newProducts.length - 25} more new products...
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Explicit confirmation checkbox for update / replace */}
                  {requiresConfirmation && (
                    <label className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-900 border border-amber-700/60 text-xs text-amber-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmedModeAction}
                        onChange={(e) => setConfirmedModeAction(e.target.checked)}
                        className="mt-0.5"
                      />
                      <span>
                        I have reviewed the import preview above and confirm applying{' '}
                        <strong>{importMode.toUpperCase()}</strong> mode to the catalog.
                      </span>
                    </label>
                  )}
                </div>
              )}

              {requiresConfirmation && !hasCurrentPreview && csvInput.trim().length > 0 && (
                <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-800/50 text-xs text-amber-200">
                  Click <strong>Preview Import</strong> first to inspect catalog changes and unlock confirmation for{' '}
                  <strong>{importMode}</strong> mode.
                </div>
              )}

              {importStats && (
                <div
                  className={`p-3 rounded-lg text-xs space-y-1 ${
                    importStats.count !== undefined
                      ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800'
                      : 'bg-rose-950/40 text-rose-300 border border-rose-800'
                  }`}
                >
                  {importStats.count !== undefined && importStats.summary ? (
                    <>
                      <div className="font-semibold">
                        ✓ Imported {importStats.summary.totalCsvRows} CSV rows into{' '}
                        {importStats.summary.uniqueCsvProducts} unique products (
                        {importStats.summary.totalCsvVariants} variants) using{' '}
                        {importStats.summary.mode.toUpperCase()} mode.
                      </div>
                      <div className="text-[11px] text-emerald-200/90">
                        Catalog now has {importStats.summary.catalogCountAfter} products &amp;{' '}
                        {importStats.summary.totalCatalogVariantsAfter} variants (
                        {importStats.summary.newProductsAdded} new,{' '}
                        {importStats.summary.matchedProductsModified} matched updated,{' '}
                        {importStats.summary.matchedProductsUnchanged} matched unchanged
                        {importStats.summary.conflictsCount > 0
                          ? `, ${importStats.summary.conflictsCount} conflicts preserved separately`
                          : ''}
                        ).
                      </div>
                    </>
                  ) : importStats.count !== undefined ? (
                    `✓ Successfully parsed & imported ${importStats.count} products!`
                  ) : (
                    `✗ Import error: ${importStats.error}`
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2 flex-wrap">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handlePreviewImport}
                  disabled={isPreviewing || isProcessing || !csvInput.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg shadow-sm transition disabled:opacity-50"
                >
                  <Eye className="w-4 h-4 text-sky-400" />
                  <span>{isPreviewing ? 'Analyzing CSV...' : 'Preview Import'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleRunImport}
                  disabled={!canApplyImport}
                  className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white rounded-lg shadow-sm transition disabled:opacity-50 ${
                    importMode === 'replace'
                      ? 'bg-rose-600 hover:bg-rose-500'
                      : importMode === 'update'
                      ? 'bg-amber-600 hover:bg-amber-500'
                      : 'bg-indigo-600 hover:bg-indigo-500'
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  <span>
                    {isProcessing
                      ? 'Importing...'
                      : importMode === 'replace'
                      ? 'Confirm & Replace Catalog'
                      : importMode === 'update'
                      ? 'Confirm & Update Catalog'
                      : 'Merge Into Catalog'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};


import React, { useState } from 'react';
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
} from 'lucide-react';
import { ProductItem } from '../types/feed';
import { generateMerchantCenterCsv } from '../utils/csv';

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
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [isProcessing, setIsProcessing] = useState(false);
  const [importStats, setImportStats] = useState<{ count?: number; error?: string } | null>(null);
  const [copiedCsv, setCopiedCsv] = useState(false);

  if (!isOpen) return null;

  // Validation before export calculation
  const totalProducts = products.length;
  const blockingItems = products.filter((p) => !p.validation.isValid);
  const warningItems = products.filter((p) => p.validation.isValid && p.validation.warnings.length > 0);
  const readyItems = products.filter((p) => p.validation.isValid && p.validation.warnings.length === 0);

  const canExport = totalProducts > 0;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvInput(text);
    };
    reader.readAsText(file);
  };

  const handleRunImport = async () => {
    if (!csvInput.trim()) return;
    setIsProcessing(true);
    setImportStats(null);

    try {
      const response = await fetch('/api/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText: csvInput, mode: importMode }),
      });

      const data = await response.json();
      if (data.success) {
        setImportStats({ count: data.count });
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
                Merchant Center Feed CSV Manager
              </h3>
              <p className="text-xs text-slate-400">
                Import existing feed files or export Google-compliant shopping feed
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
                    Deterministic Feed Compliance Check
                  </h4>
                  {blockingItems.length === 0 ? (
                    <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                      <CheckCircle2 className="w-3.5 h-3.5" /> READY FOR EXPORT
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-950/80 text-rose-300 border border-rose-800">
                      <XCircle className="w-3.5 h-3.5" /> EXPORT BLOCKED ({blockingItems.length} Issues)
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs">
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
                    <span className="text-base font-bold text-rose-200">{blockingItems.length}</span>
                    <span className="text-[11px] text-slate-400 block mt-0.5">Must be fixed before live feed</span>
                  </div>
                </div>

                {/* Blocking Issues List */}
                {blockingItems.length > 0 && (
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
              <div className="flex items-center justify-end gap-3 pt-2">
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
                  Select CSV / TSV File or Paste Raw Content
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
                  onChange={(e) => setCsvInput(e.target.value)}
                  placeholder="Paste RFC 4180 CSV text with headers (id, title, description, link, price, ...)"
                  rows={8}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 p-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500 transition"
                />
              </div>

              {/* Import Options */}
              <div className="flex items-center gap-4 text-xs">
                <span className="text-slate-400">Import Mode:</span>
                <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    value="merge"
                    checked={importMode === 'merge'}
                    onChange={() => setImportMode('merge')}
                  />
                  <span>Merge with existing (Update matched IDs, preserve extra)</span>
                </label>
                <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    value="replace"
                    checked={importMode === 'replace'}
                    onChange={() => setImportMode('replace')}
                  />
                  <span>Replace entire catalog</span>
                </label>
              </div>

              {importStats && (
                <div
                  className={`p-3 rounded-lg text-xs ${
                    importStats.count !== undefined
                      ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800'
                      : 'bg-rose-950/40 text-rose-300 border border-rose-800'
                  }`}
                >
                  {importStats.count !== undefined
                    ? `✓ Successfully parsed & imported ${importStats.count} products! Original imported values preserved for comparison.`
                    : `✗ Import error: ${importStats.error}`}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleRunImport}
                  disabled={isProcessing || !csvInput.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-sm transition disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  <span>{isProcessing ? 'Importing...' : 'Parse & Ingest CSV'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

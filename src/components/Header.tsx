import React from 'react';
import {
  Sparkles,
  Layers,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Plus,
  FileSpreadsheet,
  Download,
  Settings2,
  Database,
  RefreshCw,
} from 'lucide-react';
import { ProductItem } from '../types/feed';

interface HeaderProps {
  products: ProductItem[];
  modelName: string;
  onOpenBatchUrlModal: () => void;
  onOpenCsvModal: (initialTab?: 'import' | 'export') => void;
  onOpenStrategyModal: () => void;
  onRefreshCatalog: () => void;
  isLoading: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  products,
  modelName,
  onOpenBatchUrlModal,
  onOpenCsvModal,
  onOpenStrategyModal,
  onRefreshCatalog,
  isLoading,
}) => {
  const total = products.length;
  const optimized = products.filter((p) => p.status === 'optimized').length;
  const needsReview = products.filter((p) => p.status === 'needs_review').length;
  const warnings = products.filter((p) => p.status === 'warnings').length;
  const errors = products.filter((p) => p.status === 'errors').length;
  const notAnalyzed = products.filter((p) => p.status === 'not_analyzed').length;

  return (
    <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30 px-6 py-3.5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 max-w-[1600px] mx-auto">
        {/* Brand & Identity */}
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold shadow-inner">
            <Sparkles className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-slate-100 tracking-tight">
                Science of Gifts
              </h1>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800/60 uppercase tracking-wider">
                Merchant Feed Optimizer
              </span>
              <span className="text-[11px] text-slate-400 font-mono bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/50">
                {modelName}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Evidence-based product understanding, gift-search intent & quality audit
            </p>
          </div>
        </div>

        {/* Catalog Status Metrics Bar */}
        <div className="flex items-center flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/90 border border-slate-700/70 text-slate-200">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-semibold">{total}</span>
            <span className="text-slate-400">Total</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/40 border border-emerald-800/60 text-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-semibold">{optimized}</span>
            <span className="text-emerald-400/80">Optimized</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-950/40 border border-amber-800/60 text-amber-300">
            <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-semibold">{needsReview}</span>
            <span className="text-amber-400/80">Review</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-orange-950/40 border border-orange-800/60 text-orange-300">
            <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
            <span className="font-semibold">{warnings}</span>
            <span className="text-orange-400/80">Warnings</span>
          </div>

          {errors > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-950/50 border border-rose-800/80 text-rose-300">
              <XCircle className="w-3.5 h-3.5 text-rose-400" />
              <span className="font-semibold">{errors}</span>
              <span className="text-rose-400/80">Errors</span>
            </div>
          )}

          {notAnalyzed > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/50 border border-slate-700/40 text-slate-400">
              <span className="font-semibold text-slate-300">{notAnalyzed}</span>
              <span>Pending</span>
            </div>
          )}
        </div>

        {/* Global Action Tools */}
        <div className="flex items-center gap-2">
          <button
            onClick={onRefreshCatalog}
            disabled={isLoading}
            title="Refresh Catalog Data"
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg border border-slate-700/60 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
          </button>

          <button
            onClick={onOpenBatchUrlModal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            <span>Ingest URLs</span>
          </button>

          <button
            onClick={() => onOpenCsvModal('import')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            <FileSpreadsheet className="w-4 h-4 text-slate-300" />
            <span>Import CSV</span>
          </button>

          <button
            onClick={() => onOpenCsvModal('export')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white shadow-sm transition"
          >
            <Download className="w-4 h-4" />
            <span>Export Feed CSV</span>
          </button>

          <button
            onClick={onOpenStrategyModal}
            title="Science of Gifts Strategy & Taxonomy Configuration"
            className="p-2 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition"
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};

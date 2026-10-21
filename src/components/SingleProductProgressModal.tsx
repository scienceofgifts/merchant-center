import React from 'react';
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  XCircle,
  X,
  RotateCcw,
  AlertTriangle,
  FileText,
  Search,
  Wand2,
  ShieldCheck,
  Save,
  Check,
} from 'lucide-react';

interface SingleProductProgressModalProps {
  isOpen: boolean;
  productName: string;
  productImageUrl?: string;
  isRunning: boolean;
  currentStage: number; // 0 to 6
  isCancelled: boolean;
  error?: string | null;
  successMessage?: string | null;
  onCancel: () => void;
  onRetry: () => void;
  onClose: () => void;
}

const STAGES = [
  { id: 0, label: 'Fetching product evidence', icon: FileText, desc: 'Retrieving product source data, JSON-LD, and variant specs' },
  { id: 1, label: 'Analyzing product details', icon: Search, desc: 'Conducting AI strategy research and intent mapping' },
  { id: 2, label: 'Generating or improving the title and description', icon: Wand2, desc: 'Constructing compliant front-loaded titles and compelling descriptions' },
  { id: 3, label: 'Extracting and validating attributes', icon: Sparkles, desc: 'Reconciling size, color, material against verified evidence' },
  { id: 4, label: 'Optimizing custom labels and taxonomy', icon: FileText, desc: 'Applying strict 5-tier semantic custom labels and GPC classification' },
  { id: 5, label: 'Running the quality audit', icon: ShieldCheck, desc: 'Executing independent Google Merchant Center compliance audit' },
  { id: 6, label: 'Saving or applying results', icon: Save, desc: 'Recording history diff, provenance, and persisting catalog state' },
];

export const SingleProductProgressModal: React.FC<SingleProductProgressModalProps> = ({
  isOpen,
  productName,
  productImageUrl,
  isRunning,
  currentStage,
  isCancelled,
  error,
  successMessage,
  onCancel,
  onRetry,
  onClose,
}) => {
  if (!isOpen) return null;

  const isFinished = !isRunning && !isCancelled && !error;
  const isFailed = !!error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-indigo-950 border border-indigo-700/60 text-indigo-400 shrink-0">
              {isRunning ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isCancelled ? (
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              ) : isFailed ? (
                <XCircle className="w-5 h-5 text-rose-400" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-100 truncate flex items-center gap-2">
                <span>Generating & Optimizing Product</span>
                {isRunning && (
                  <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 text-[10px] font-semibold">
                    In Progress
                  </span>
                )}
                {isCancelled && (
                  <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 text-[10px] font-semibold">
                    Cancelled
                  </span>
                )}
                {isFinished && (
                  <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-semibold">
                    Completed
                  </span>
                )}
                {isFailed && (
                  <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 text-[10px] font-semibold">
                    Failed
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-400 truncate mt-0.5">{productName}</p>
            </div>
          </div>

          {(!isRunning || isCancelled || isFailed || isFinished) && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Product Preview Bar */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-950 border border-slate-800">
            {productImageUrl ? (
              <img
                src={productImageUrl}
                alt={productName}
                className="w-10 h-10 object-cover rounded-lg bg-slate-900 border border-slate-700 shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-xs text-slate-500 font-mono shrink-0">
                IMG
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h4 className="text-xs font-semibold text-slate-200 truncate">{productName}</h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {isRunning
                  ? STAGES[Math.min(currentStage, STAGES.length - 1)].label + '...'
                  : isCancelled
                  ? 'Operation cancelled by user.'
                  : isFailed
                  ? `Error: ${error}`
                  : successMessage || 'Optimization completed successfully!'}
              </p>
            </div>
          </div>

          {/* Stages Checklist */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-2">
              Optimization Pipeline Stages
            </span>

            <div className="space-y-1.5 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
              {STAGES.map((stage) => {
                const isCompleted = !isCancelled && !isFailed && (currentStage > stage.id || isFinished);
                const isActive = isRunning && currentStage === stage.id;
                const isPending = !isCompleted && !isActive;

                const StageIcon = stage.icon;

                return (
                  <div
                    key={stage.id}
                    className={`flex items-start gap-3 p-2.5 rounded-lg text-xs transition ${
                      isActive
                        ? 'bg-indigo-950/60 border border-indigo-500/50 text-indigo-200 shadow-sm'
                        : isCompleted
                        ? 'text-slate-300 bg-slate-900/40'
                        : 'text-slate-500 opacity-60'
                    }`}
                  >
                    <div className="shrink-0 pt-0.5">
                      {isCompleted ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : isActive ? (
                        <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border border-slate-700 flex items-center justify-center text-[9px] font-mono">
                          {stage.id + 1}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className={`font-semibold ${isActive ? 'text-indigo-200' : isCompleted ? 'text-slate-200' : 'text-slate-400'}`}>
                          {stage.id + 1}. {stage.label}
                        </span>
                        {isActive && <span className="text-[10px] text-indigo-400 font-mono animate-pulse">Processing...</span>}
                        {isCompleted && <span className="text-[10px] text-emerald-400 font-mono">Done</span>}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">{stage.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Error Banner */}
          {isFailed && (
            <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800 text-xs text-rose-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <span className="font-semibold">Optimization Error: </span>
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* Cancelled Banner */}
          {isCancelled && (
            <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800 text-xs text-amber-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Operation cancelled. Existing product data and IDs were fully preserved.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/80">
          <div className="text-xs text-slate-400">
            {isRunning ? (
              <span className="text-indigo-400 font-medium flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing active pipeline stages...
              </span>
            ) : isCancelled ? (
              <span className="text-amber-400 font-medium">Operation successfully cancelled.</span>
            ) : isFailed ? (
              <span className="text-rose-400 font-medium">Operation failed. You can retry safely.</span>
            ) : (
              <span className="text-emerald-400 font-medium">✓ Optimization completed successfully.</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {isRunning && (
              <button
                type="button"
                onClick={onCancel}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition"
              >
                <X className="w-4 h-4" />
                <span>Cancel Operation</span>
              </button>
            )}

            {(isCancelled || isFailed) && (
              <button
                type="button"
                onClick={onRetry}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-md transition"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Retry Operation</span>
              </button>
            )}

            {isFinished && (
              <button
                type="button"
                onClick={onClose}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md transition"
              >
                <Check className="w-4 h-4" />
                <span>Review Results</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  XCircle,
  Pause,
  Play,
  X,
  RotateCcw,
  AlertTriangle,
  MinusCircle,
  BarChart3,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { BulkOptimizationItem, BulkQueueSummary } from '../types/bulk';

interface BulkProgressModalProps {
  isOpen: boolean;
  items: BulkOptimizationItem[];
  isRunning: boolean;
  isPaused: boolean;
  isCancelled: boolean;
  currentIndex: number;
  summary: BulkQueueSummary | null;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRetryFailed: () => void;
  onClose: () => void;
}

export const BulkProgressModal: React.FC<BulkProgressModalProps> = ({
  isOpen,
  items,
  isRunning,
  isPaused,
  isCancelled,
  currentIndex,
  summary,
  onPause,
  onResume,
  onCancel,
  onRetryFailed,
  onClose,
}) => {
  const [showDetails, setShowDetails] = useState(true);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  if (!isOpen) return null;

  const total = items.length;
  const completed = items.filter((i) => i.status === 'COMPLETED').length;
  const failed = items.filter((i) => i.status === 'FAILED').length;
  const skipped = items.filter((i) => i.status === 'SKIPPED').length;
  const cancelled = items.filter((i) => i.status === 'CANCELLED').length;
  const processed = completed + failed + skipped + cancelled;
  const currentItem = isRunning && !isCancelled && items[currentIndex] ? items[currentIndex] : null;

  const progressPercent = total > 0 ? Math.round((processed / total) * 100) : 0;
  const isFinished = (!isRunning || isCancelled) && processed > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh] overflow-hidden text-slate-100">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-950/80 border border-indigo-700/60 text-indigo-400">
              {isRunning && !isCancelled ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isCancelled ? (
                <MinusCircle className="w-5 h-5 text-amber-400" />
              ) : isFinished ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              ) : (
                <Sparkles className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
                <span>Optimizing Products</span>
                {!isRunning && isFinished && !isCancelled && (
                  <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-semibold lowercase">
                    Completed
                  </span>
                )}
                {isPaused && !isCancelled && (
                  <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 text-[10px] font-semibold lowercase">
                    Paused
                  </span>
                )}
                {isCancelled && (
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-amber-300 border border-amber-700/60 text-[10px] font-semibold lowercase">
                    Cancelled
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-400 font-mono">
                {processed} of {total} processed ({progressPercent}%)
              </p>
            </div>
          </div>

          {(!isRunning || isCancelled) && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title="Close modal"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Main Progress Bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-slate-300">Overall Optimization Queue</span>
              <span className="font-mono text-indigo-400">{progressPercent}%</span>
            </div>
            <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-800/80">
              <div
                className={`h-2.5 rounded-full transition-all duration-300 ${
                  isFinished && !isCancelled
                    ? 'bg-emerald-500'
                    : isCancelled
                    ? 'bg-amber-600/80'
                    : isPaused
                    ? 'bg-amber-500'
                    : 'bg-gradient-to-r from-indigo-500 to-purple-500'
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
              <span className="text-emerald-400 font-medium">✓ {completed} completed</span>
              {failed > 0 && <span className="text-rose-400 font-medium">✕ {failed} failed</span>}
              {skipped > 0 && <span className="text-amber-400 font-medium">– {skipped} skipped</span>}
              {cancelled > 0 && <span className="text-slate-400 font-medium">– {cancelled} cancelled</span>}
              <span>{Math.max(0, total - processed)} remaining</span>
            </div>
          </div>

          {/* Cancellation Notice Banner */}
          {isCancelled && (
            <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-800/50 text-xs text-amber-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Queue cancelled. Completed products ({completed}) are saved; remaining products were not changed.</span>
              </div>
            </div>
          )}

          {/* Currently Optimizing Highlight Banner */}
          {isRunning && !isCancelled && currentItem && (
            <div className="p-3.5 rounded-xl bg-gradient-to-r from-indigo-950/80 via-slate-900 to-purple-950/60 border border-indigo-600/50 shadow-md space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                  <span className="text-xs font-bold text-indigo-200 uppercase tracking-wider">Current Target:</span>
                </div>
                <span className="text-[10px] font-mono text-indigo-300 bg-indigo-950 px-2 py-0.5 rounded border border-indigo-800">
                  Item #{currentIndex + 1} of {total}
                </span>
              </div>

              <div className="flex items-center gap-3">
                {currentItem.image_link && (
                  <img
                    src={currentItem.image_link}
                    alt={currentItem.title}
                    className="w-9 h-9 object-cover rounded bg-slate-950 border border-slate-800 shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <h4 className="text-xs font-semibold text-slate-100 truncate">{currentItem.title}</h4>
                  <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono mt-0.5">
                    <span className="text-indigo-300 font-medium">1. Analyze Evidence</span>
                    <span>→</span>
                    <span className="text-indigo-300 font-medium">2. Generate & Optimize</span>
                    <span>→</span>
                    <span className="text-indigo-300 font-medium">3. Audit & Save</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Final Summary Card (When finished/stopped) */}
          {summary && !isRunning && (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3.5">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-200 uppercase tracking-wider">
                  <BarChart3 className="w-4 h-4 text-emerald-400" />
                  <span>Bulk Optimization Summary</span>
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  {summary.completedCount} / {summary.totalSelected} items optimized
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block font-medium">Processed Status</span>
                  <span className="font-bold text-emerald-400 text-sm">
                    {summary.completedCount} <span className="text-xs font-normal text-slate-400">Success</span>
                  </span>
                  {summary.failedCount > 0 && (
                    <span className="text-[10px] text-rose-400 block mt-0.5">
                      {summary.failedCount} Failed
                    </span>
                  )}
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-[10px] text-slate-400 block font-medium">Average Score</span>
                  <span className="font-bold text-slate-100 font-mono text-sm">
                    {summary.avgBeforeScore} → <span className="text-emerald-400">{summary.avgAfterScore}</span>
                  </span>
                  <span className="text-[10px] text-emerald-400 block font-medium">
                    +{Math.max(0, summary.avgAfterScore - summary.avgBeforeScore)} pts gain
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 col-span-2">
                  <span className="text-[10px] text-slate-400 block font-medium mb-1">
                    Fields Improved Across Selected Set
                  </span>
                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-200 border border-indigo-800">
                      Title: {summary.fieldCounts.title}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-200 border border-indigo-800">
                      Description: {summary.fieldCounts.description}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-200 border border-indigo-800">
                      Product Type: {summary.fieldCounts.productType}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-200 border border-indigo-800">
                      Google Category: {summary.fieldCounts.googleProductCategory}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-200 border border-indigo-800">
                      Custom Labels: {summary.fieldCounts.customLabels}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Per-Product Status List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Product Execution Queue & Status ({total})
              </span>
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium"
              >
                <span>{showDetails ? 'Collapse List' : 'Expand List'}</span>
                {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>

            {showDetails && (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {items.map((item, idx) => {
                  const isCurrent = isRunning && idx === currentIndex;
                  const isExpanded = expandedItemId === item.id;

                  return (
                    <div
                      key={item.id}
                      className={`p-3 rounded-xl border text-xs transition-all ${
                        isCurrent
                          ? 'bg-indigo-950/40 border-indigo-500/80 shadow-md ring-1 ring-indigo-500/30'
                          : item.status === 'COMPLETED'
                          ? 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                          : item.status === 'FAILED'
                          ? 'bg-rose-950/20 border-rose-900/50'
                          : item.status === 'SKIPPED'
                          ? 'bg-amber-950/20 border-amber-900/40'
                          : item.status === 'CANCELLED'
                          ? 'bg-slate-900/50 border-slate-800/80 text-slate-400'
                          : 'bg-slate-950/60 border-slate-800/80 opacity-70'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          {item.image_link ? (
                            <img
                              src={item.image_link}
                              alt={item.title}
                              className="w-8 h-8 object-cover rounded bg-slate-950 border border-slate-800 shrink-0"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center text-[10px] text-slate-500 shrink-0">
                              IMG
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h5 className="font-semibold text-slate-200 truncate">{item.title}</h5>
                            </div>

                            {item.status === 'COMPLETED' && item.beforeScore !== undefined && item.afterScore !== undefined && (
                              <p className="text-[11px] text-emerald-400 font-mono mt-0.5">
                                Score: {item.beforeScore} → <span className="font-bold">{item.afterScore}</span> (+
                                {Math.max(0, item.afterScore - item.beforeScore)} pts)
                              </p>
                            )}

                            {item.status === 'FAILED' && item.error && (
                              <p className="text-[11px] text-rose-400 font-mono mt-0.5 truncate">
                                Error: {item.error}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Status Badge */}
                        <div className="shrink-0 flex items-center gap-2">
                          {item.status === 'COMPLETED' ? (
                            <span className="px-2.5 py-1 rounded-lg bg-emerald-950 text-emerald-300 border border-emerald-800/80 text-[11px] font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Completed</span>
                            </span>
                          ) : item.status === 'OPTIMIZING' ? (
                            <span className="px-2.5 py-1 rounded-lg bg-indigo-950 text-indigo-300 border border-indigo-700/80 text-[11px] font-semibold flex items-center gap-1.5 animate-pulse">
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                              <span>Optimizing...</span>
                            </span>
                          ) : item.status === 'FAILED' ? (
                            <span className="px-2.5 py-1 rounded-lg bg-rose-950 text-rose-300 border border-rose-800/80 text-[11px] font-semibold flex items-center gap-1">
                              <XCircle className="w-3.5 h-3.5 text-rose-400" />
                              <span>Failed</span>
                            </span>
                          ) : item.status === 'SKIPPED' ? (
                            <span className="px-2.5 py-1 rounded-lg bg-amber-950 text-amber-300 border border-amber-800/80 text-[11px] font-semibold flex items-center gap-1">
                              <MinusCircle className="w-3.5 h-3.5 text-amber-400" />
                              <span>Skipped</span>
                            </span>
                          ) : item.status === 'CANCELLED' ? (
                            <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 text-[11px] font-semibold flex items-center gap-1">
                              <MinusCircle className="w-3.5 h-3.5 text-slate-400" />
                              <span>Cancelled</span>
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-slate-400 border border-slate-800 text-[11px] font-medium">
                              ○ Queued
                            </span>
                          )}

                          {item.appliedFields && item.appliedFields.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                              className="text-slate-400 hover:text-slate-200 p-1 rounded"
                              title="Toggle details"
                            >
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expanded Field Details */}
                      {isExpanded && item.appliedFields && item.appliedFields.length > 0 && (
                        <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex flex-wrap gap-1 text-[10px]">
                          <span className="text-slate-400 font-medium block w-full mb-1">Applied Improvements:</span>
                          {item.appliedFields.map((f, i) => (
                            <span key={i} className="px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800/60">
                              ✓ {f}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer Controls */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/80">
          <div className="text-xs text-slate-400">
            {isRunning && !isCancelled ? (
              <span className="flex items-center gap-1.5 text-indigo-400 font-medium">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Sequential queue running (Concurrency = 1)
              </span>
            ) : isPaused && !isCancelled ? (
              <span className="text-amber-400 font-medium">Queue paused. Click Resume to continue.</span>
            ) : isCancelled ? (
              <span className="text-slate-400 font-medium">Queue cancelled. {completed} of {total} products were saved.</span>
            ) : (
              <span>Completed queue processing.</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Running controls (only active when running and NOT cancelled) */}
            {isRunning && !isPaused && !isCancelled && (
              <>
                <button
                  type="button"
                  onClick={onPause}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-950/80 hover:bg-amber-900 text-amber-200 border border-amber-700/80 font-semibold text-xs transition"
                >
                  <Pause className="w-4 h-4" />
                  <span>Pause Queue</span>
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition"
                >
                  <X className="w-4 h-4" />
                  <span>Cancel Remaining</span>
                </button>
              </>
            )}

            {/* Paused controls (only active when paused and NOT cancelled) */}
            {isRunning && isPaused && !isCancelled && (
              <>
                <button
                  type="button"
                  onClick={onResume}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-md transition"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>Resume Queue</span>
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition"
                >
                  <X className="w-4 h-4" />
                  <span>Cancel Remaining</span>
                </button>
              </>
            )}

            {/* Finished / Cancelled controls */}
            {(!isRunning || isCancelled) && (
              <>
                {(failed > 0 || (isCancelled && (cancelled > 0 || failed > 0))) && (
                  <button
                    type="button"
                    onClick={onRetryFailed}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-md transition"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>{isCancelled ? 'Resume Remaining' : `Retry Failed (${failed})`}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md transition"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{isCancelled ? 'Close Dialog' : 'Review Results'}</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

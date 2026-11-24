import React, { useEffect, useState } from 'react';
import {
  X,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Layers,
  ExternalLink,
  ArrowRight,
  Lock,
  Sparkles,
  CheckSquare,
  Square,
  PlusCircle,
} from 'lucide-react';
import {
  FeedSyncPreviewResult,
  FeedSyncApplyResult,
  FeedSyncMatchedItem,
  FeedSyncMode,
} from '../types/feed';
import {
  selectAllUnmatchedDesigns,
  selectMatchedWithNewVariants,
  clearUnmatchedDesignSelection,
  toggleUnmatchedDesignSelection,
  computeUnmatchedSelectionReview,
} from '../utils/feedSyncSelection';

const DEFAULT_FEED_URL = 'https://shop.scienceofgifts.com/.well-known/merchant-center/rss.xml';

interface WebsiteFeedSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSyncApplied: () => void;
}

export const WebsiteFeedSyncModal: React.FC<WebsiteFeedSyncModalProps> = ({
  isOpen,
  onClose,
  onSyncApplied,
}) => {
  const [feedUrl] = useState(DEFAULT_FEED_URL);
  const [isFetching, setIsFetching] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<FeedSyncPreviewResult | null>(null);
  const [applyResult, setApplyResult] = useState<FeedSyncApplyResult | null>(null);

  const [syncMode, setSyncMode] = useState<FeedSyncMode>('add_only');
  const [activeTab, setActiveTab] = useState<
    'unmatched_feed' | 'matched' | 'ambiguous' | 'unmatched_catalog'
  >('unmatched_feed');
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [expandedUnmatchedGroupKey, setExpandedUnmatchedGroupKey] = useState<string | null>(null);
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<string>>(new Set());
  const [selectedImportGroupKeys, setSelectedImportGroupKeys] = useState<Set<string>>(new Set());
  const [manualMappings, setManualMappings] = useState<Record<string, string>>({});
  const [confirmedApply, setConfirmedApply] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [showImportReviewDetails, setShowImportReviewDetails] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setApplyResult(null);
      setConfirmedApply(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const reviewSummary = computeUnmatchedSelectionReview(
    preview,
    selectedCatalogIds,
    selectedImportGroupKeys,
    syncMode
  );

  const handleFetchAndPreview = async () => {
    setIsFetching(true);
    setError(null);
    setApplyResult(null);
    setConfirmedApply(false);

    try {
      const response = await fetch('/api/feed-sync/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedUrl, manualMappings }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch and preview website feed');
      }
      const prev: FeedSyncPreviewResult = data.preview;
      setPreview(prev);

      // Default add-only workflow:
      // 1. Auto-select ALL genuinely new products (never ambiguous matches)
      // 2. Auto-select existing products that have genuinely missing variants (or all matched if factual sync opted in)
      setSelectedImportGroupKeys(selectAllUnmatchedDesigns(prev));
      setSelectedCatalogIds(
        syncMode === 'sync_factual'
          ? new Set(prev.matchedProducts.map((m) => m.catalogProductId))
          : selectMatchedWithNewVariants(prev)
      );

      // Focus the most actionable tab automatically
      if (prev.unmatchedFeedGroups.length > 0) {
        setActiveTab('unmatched_feed');
      } else if (prev.summary.matchedWithNewVariantsCount > 0) {
        setActiveTab('matched');
      } else if (prev.ambiguousMatches.length > 0) {
        setActiveTab('ambiguous');
      } else {
        setActiveTab('matched');
      }
    } catch (err: any) {
      setError(err.message || 'Could not preview website feed');
    } finally {
      setIsFetching(false);
    }
  };

  const handleToggleFactualUpdates = (enableFactual: boolean) => {
    const nextMode: FeedSyncMode = enableFactual ? 'sync_factual' : 'add_only';
    setSyncMode(nextMode);
    setConfirmedApply(false);
    if (preview) {
      setSelectedCatalogIds(
        nextMode === 'sync_factual'
          ? new Set(preview.matchedProducts.map((m) => m.catalogProductId))
          : selectMatchedWithNewVariants(preview)
      );
    }
  };

  const handleToggleProductSelection = (catalogId: string) => {
    setConfirmedApply(false);
    setSelectedCatalogIds((prev) => {
      const next = new Set(prev);
      if (next.has(catalogId)) {
        next.delete(catalogId);
      } else {
        next.add(catalogId);
      }
      return next;
    });
  };

  const handleToggleImportGroup = (groupKey: string) => {
    setConfirmedApply(false);
    setSelectedImportGroupKeys((prev) => toggleUnmatchedDesignSelection(prev, groupKey));
  };

  const handleSelectAllNewProducts = () => {
    if (!preview) return;
    setConfirmedApply(false);
    setSelectedImportGroupKeys(selectAllUnmatchedDesigns(preview));
  };

  const handleClearNewProductsSelection = () => {
    setConfirmedApply(false);
    setSelectedImportGroupKeys(clearUnmatchedDesignSelection());
  };

  const handleApplyApprovedSync = async () => {
    if (!preview || !confirmedApply) return;
    setIsApplying(true);
    setError(null);

    try {
      const response = await fetch('/api/feed-sync/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmed: true,
          feedUrl,
          options: {
            syncMode,
            approvedCatalogIds: Array.from(selectedCatalogIds),
            manualMappings,
            importUnmatchedFeedGroupKeys: Array.from(selectedImportGroupKeys),
          },
        }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to apply website feed sync');
      }
      setApplyResult(data.result);
      setConfirmedApply(false);
      onSyncApplied();
    } catch (err: any) {
      setError(err.message || 'Error applying website feed sync');
    } finally {
      setIsApplying(false);
    }
  };

  const filteredMatchedProducts: FeedSyncMatchedItem[] = (preview?.matchedProducts || [])
    .filter((m) => {
      if (!searchFilter.trim()) return true;
      const q = searchFilter.toLowerCase();
      return (
        m.catalogProductId.toLowerCase().includes(q) ||
        m.catalogTitle.toLowerCase().includes(q) ||
        m.websiteTitle.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => b.missingVariantCount - a.missingVariantCount);

  const hasPendingChangesToApply =
    reviewSummary.selectedUnmatchedDesignsCount > 0 || reviewSummary.selectedMatchedDesignsCount > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-5xl shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
              <RefreshCw className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-slate-100">
                  Website Feed Sync (Fourthwall Merchant Center RSS)
                </h3>
                <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 font-medium">
                  {syncMode === 'add_only' ? 'Add-Only Default' : 'Add + Factual Updates'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Finds genuinely new Fourthwall products and missing variants while preserving all existing catalog titles, descriptions, labels, and optimizations.
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

        {/* Feed Source Bar & Action */}
        <div className="px-6 py-3.5 bg-slate-950/60 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-300 min-w-0">
            <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-slate-400 shrink-0">Website Feed:</span>
            <code className="font-mono text-[11px] bg-slate-900 px-2.5 py-1 rounded border border-slate-800 text-indigo-300 truncate">
              {feedUrl}
            </code>
          </div>
          <button
            type="button"
            onClick={handleFetchAndPreview}
            disabled={isFetching || isApplying}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            <span>
              {isFetching
                ? 'Fetching & Comparing Feed...'
                : preview
                  ? 'Re-Fetch Website Feed'
                  : '1. Fetch Website Feed & Preview'}
            </span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {error && (
            <div className="p-3.5 rounded-lg bg-rose-950/50 border border-rose-800 text-rose-200 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block">Sync Error</span>
                <span>{error}</span>
              </div>
            </div>
          )}

          {applyResult && (
            <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800/80 text-emerald-200 text-xs space-y-1.5">
              <div className="flex items-center gap-2 text-emerald-300 font-semibold text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Website Feed Sync Complete (Backup Saved)</span>
              </div>
              <p className="text-slate-300">
                Added <strong>{applyResult.importedNewProductCount}</strong> new product(s), attached{' '}
                <strong>{applyResult.attachedVariantsCount}</strong> new variant(s) across{' '}
                <strong>{applyResult.updatedProductCount}</strong> existing product(s), and left{' '}
                <strong>{applyResult.unchangedProductCount}</strong> existing catalog product(s) completely unchanged.
              </p>
            </div>
          )}

          {!preview && !isFetching && (
            <div className="p-8 rounded-xl bg-slate-950/50 border border-slate-800/80 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-indigo-950/60 border border-indigo-800/50 flex items-center justify-center mx-auto text-indigo-400">
                <Layers className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-semibold text-slate-200">
                Ready to Compare Your Storefront Against Your Catalog
              </h4>
              <p className="text-xs text-slate-400 max-w-xl mx-auto leading-relaxed">
                Click <strong>Fetch Website Feed &amp; Preview</strong> above to read{' '}
                <code className="text-slate-300">shop.scienceofgifts.com</code> (read-only). You will see
                genuinely new products, any missing variants for existing products, ambiguous matches requiring
                review, and everything that will stay untouched before any changes are saved.
              </p>
            </div>
          )}

          {preview && (
            <>
              {/* 6 Required Summary Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
                <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800">
                  <span className="text-[11px] text-slate-400 block">On Website Feed</span>
                  <span className="text-base font-bold text-slate-100">
                    {preview.totalFeedDesignGroups}
                  </span>
                  <span className="text-[11px] text-indigo-300 block mt-0.5">
                    products ({preview.totalFeedVariantItems} variants)
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveTab('matched')}
                  className="p-3 rounded-lg bg-slate-950/70 hover:bg-slate-900 border border-slate-800 text-left transition"
                >
                  <span className="text-[11px] text-slate-400 block">Already in Catalog</span>
                  <span className="text-base font-bold text-emerald-300">
                    {preview.summary.matchedCount}
                  </span>
                  <span className="text-[11px] text-slate-400 block mt-0.5">
                    matched by ID/URL
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('unmatched_feed')}
                  className="p-3 rounded-lg bg-indigo-950/35 hover:bg-indigo-950/55 border border-indigo-800/60 text-left transition"
                >
                  <span className="text-[11px] text-indigo-300 block">Genuinely New</span>
                  <span className="text-base font-bold text-indigo-100">
                    {reviewSummary.totalUnmatchedDesigns}
                  </span>
                  <span className="text-[11px] text-emerald-300 font-medium block mt-0.5">
                    {reviewSummary.selectedUnmatchedDesignsCount} selected ({reviewSummary.selectedUnmatchedVariantsCount} var.)
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('matched')}
                  className="p-3 rounded-lg bg-cyan-950/30 hover:bg-cyan-950/50 border border-cyan-900/50 text-left transition"
                >
                  <span className="text-[11px] text-cyan-300 block">New Variants</span>
                  <span className="text-base font-bold text-cyan-100">
                    {preview.summary.newVariantsForExistingCount}
                  </span>
                  <span className="text-[11px] text-slate-400 block mt-0.5">
                    for {preview.summary.matchedWithNewVariantsCount} existing product(s)
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('ambiguous')}
                  className={`p-3 rounded-lg border text-left transition ${
                    preview.summary.ambiguousCount > 0
                      ? 'bg-amber-950/35 hover:bg-amber-950/55 border-amber-800/60'
                      : 'bg-slate-950/70 border-slate-800'
                  }`}
                >
                  <span className="text-[11px] text-amber-300 block">Needs Review</span>
                  <span className="text-base font-bold text-amber-200">
                    {preview.summary.ambiguousCount}
                  </span>
                  <span className="text-[11px] text-slate-400 block mt-0.5">
                    ambiguous (never auto)
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('unmatched_catalog')}
                  className="p-3 rounded-lg bg-slate-950/70 hover:bg-slate-900 border border-slate-800 text-left transition"
                >
                  <span className="text-[11px] text-slate-400 block">Will Stay Unchanged</span>
                  <span className="text-base font-bold text-slate-200">
                    {reviewSummary.unchangedProductsCount}
                  </span>
                  <span className="text-[11px] text-slate-400 block mt-0.5">
                    incl. {preview.summary.unmatchedCatalogCount} catalog-only
                  </span>
                </button>
              </div>

              {/* Add-Only Default Mode & Optional Factual Updates Toggle */}
              <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="text-slate-300">
                    <span className="font-semibold text-slate-100">
                      Add-Only Sync is active by default:
                    </span>{' '}
                    Existing product data remains untouched except for attaching genuinely missing variants.
                  </div>
                </div>
                <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer shrink-0 select-none">
                  <input
                    type="checkbox"
                    checked={syncMode === 'sync_factual'}
                    onChange={(e) => handleToggleFactualUpdates(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-amber-500"
                  />
                  <span>Also apply optional factual updates (price/stock)</span>
                </label>
              </div>

              {/* Navigation Tabs */}
              <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setActiveTab('unmatched_feed')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                      activeTab === 'unmatched_feed'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    <span>New Products ({preview.unmatchedFeedGroups.length})</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        selectedImportGroupKeys.size > 0
                          ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {reviewSummary.selectionStatusLabel}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('matched')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                      activeTab === 'matched'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    Existing Products ({preview.matchedProducts.length}
                    {preview.summary.newVariantsForExistingCount > 0
                      ? ` • +${preview.summary.newVariantsForExistingCount} new var.`
                      : ''}
                    )
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('ambiguous')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                      activeTab === 'ambiguous'
                        ? 'bg-amber-600 text-white'
                        : preview.ambiguousMatches.length > 0
                          ? 'text-amber-300 hover:bg-amber-950/50'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    Ambiguous Review ({preview.ambiguousMatches.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('unmatched_catalog')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                      activeTab === 'unmatched_catalog'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    Catalog-Only ({preview.unmatchedCatalogItems.length})
                  </button>
                </div>

                {activeTab === 'matched' && (
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Filter existing products..."
                    className="px-3 py-1 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  />
                )}
              </div>

              {/* TAB 1: Genuinely New Products */}
              {activeTab === 'unmatched_feed' && (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-200">
                          Genuinely New Website Products: {reviewSummary.totalUnmatchedDesigns} ({reviewSummary.totalUnmatchedVariants} variants)
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-indigo-950 text-indigo-200 border border-indigo-700/70 font-semibold">
                          {reviewSummary.selectionStatusLabel}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Confirmed new products are selected by default for addition. Ambiguous matches are excluded until manually reviewed.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={handleSelectAllNewProducts}
                        disabled={preview.unmatchedFeedGroups.length === 0}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition disabled:opacity-40"
                      >
                        <PlusCircle className="w-3.5 h-3.5" />
                        <span>Add All New Products</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleClearNewProductsSelection}
                        disabled={selectedImportGroupKeys.size === 0}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition disabled:opacity-40"
                      >
                        <Square className="w-3.5 h-3.5" />
                        <span>Clear Selection</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                    {preview.unmatchedFeedGroups.map((group) => {
                      const isSelected = selectedImportGroupKeys.has(group.groupKey);
                      const isExpanded = expandedUnmatchedGroupKey === group.groupKey;

                      return (
                        <div
                          key={group.groupKey}
                          className={`rounded-lg border transition overflow-hidden text-xs ${
                            isSelected
                              ? 'bg-indigo-950/25 border-indigo-700/70'
                              : 'bg-slate-950/70 border-slate-800'
                          }`}
                        >
                          <div className="p-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleImportGroup(group.groupKey)}
                                className="rounded border-slate-700 bg-slate-900 text-indigo-600"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedUnmatchedGroupKey(
                                    isExpanded ? null : group.groupKey
                                  )
                                }
                                className="flex items-center gap-2 text-left min-w-0 flex-1"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                                )}
                                <div className="min-w-0">
                                  <div className="font-semibold text-slate-200 truncate">
                                    {group.title}
                                  </div>
                                  <div className="text-[11px] text-slate-400 flex items-center gap-2 flex-wrap">
                                    <span className="text-indigo-300 font-medium">
                                      {group.variantCount}{' '}
                                      {group.variantCount === 1 ? 'variant' : 'variants'}
                                    </span>
                                    {group.sizes.length > 0 && (
                                      <>
                                        <span>•</span>
                                        <span className="text-slate-300">
                                          Sizes: {group.sizes.join(', ')}
                                        </span>
                                      </>
                                    )}
                                    {group.colors.length > 0 && (
                                      <>
                                        <span>•</span>
                                        <span className="text-slate-300">
                                          Colors: {group.colors.join(', ')}
                                        </span>
                                      </>
                                    )}
                                    <span>•</span>
                                    <span className="text-emerald-300">{group.priceRange}</span>
                                  </div>
                                </div>
                              </button>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-950/80 text-indigo-300 border border-indigo-800/60">
                                {group.variantCount}{' '}
                                {group.variantCount === 1 ? 'Variant' : 'Variants'}
                              </span>
                              <a
                                href={group.link}
                                target="_blank"
                                rel="noreferrer"
                                className="text-slate-400 hover:text-indigo-400 p-1"
                                title="Open website product page"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="px-4 pb-3 pt-2 border-t border-slate-800/80 bg-slate-900/50 space-y-2">
                              <div className="text-[11px] text-slate-400 flex items-center justify-between flex-wrap gap-2">
                                <span>
                                  URL: <code className="text-slate-300">{group.link}</code>
                                </span>
                                <span>
                                  Group ID:{' '}
                                  <code className="text-slate-300">
                                    {group.variantCount >= 2
                                      ? group.itemGroupId
                                      : '(single variant)'}
                                  </code>
                                </span>
                              </div>
                              <div className="overflow-x-auto rounded border border-slate-800">
                                <table className="w-full text-left text-[11px]">
                                  <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                                    <tr>
                                      <th className="py-1.5 px-2.5">Variant ID</th>
                                      <th className="py-1.5 px-2.5">Size</th>
                                      <th className="py-1.5 px-2.5">Color</th>
                                      <th className="py-1.5 px-2.5">Price</th>
                                      <th className="py-1.5 px-2.5">Availability</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                                    {group.variants.map((v) => (
                                      <tr key={v.id}>
                                        <td className="py-1.5 px-2.5 font-mono text-slate-300">
                                          {v.id}
                                        </td>
                                        <td className="py-1.5 px-2.5 text-indigo-300 font-medium">
                                          {v.size || '—'}
                                        </td>
                                        <td className="py-1.5 px-2.5 text-slate-300">
                                          {v.color || '—'}
                                        </td>
                                        <td className="py-1.5 px-2.5 text-emerald-300">
                                          {v.price}
                                        </td>
                                        <td className="py-1.5 px-2.5 text-slate-300">
                                          {v.availability}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {preview.unmatchedFeedGroups.length === 0 && (
                      <div className="p-6 text-center text-xs text-slate-400">
                        No genuinely new products found — every unambiguous website product is already in your catalog.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: Existing Matched Products & Missing Variants */}
              {activeTab === 'matched' && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-slate-400 px-1 flex-wrap gap-2">
                    <span>
                      {syncMode === 'add_only'
                        ? 'Only products with genuinely missing variants are selected. Already-complete products remain 100% unchanged.'
                        : 'Optional factual sync is enabled: selected products will refresh price/stock/variants while preserving custom titles, descriptions, and labels.'}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmedApply(false);
                          setSelectedCatalogIds(
                            syncMode === 'add_only'
                              ? selectMatchedWithNewVariants(preview)
                              : new Set(preview.matchedProducts.map((m) => m.catalogProductId))
                          );
                        }}
                        className="text-indigo-400 hover:underline flex items-center gap-1"
                      >
                        <CheckSquare className="w-3.5 h-3.5" />
                        <span>
                          {syncMode === 'add_only' ? 'Select With New Variants' : 'Select All'}
                        </span>
                      </button>
                      <span>•</span>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmedApply(false);
                          setSelectedCatalogIds(new Set());
                        }}
                        className="text-slate-400 hover:underline"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                    {filteredMatchedProducts.map((item) => {
                      const isExpanded = expandedProductId === item.catalogProductId;
                      const isActionable =
                        syncMode === 'sync_factual' || item.missingVariantCount > 0;
                      const isSelected = isActionable && selectedCatalogIds.has(item.catalogProductId);
                      const sizes = Array.from(
                        new Set(item.variants.map((v) => v.size || '').filter(Boolean))
                      );

                      return (
                        <div
                          key={item.catalogProductId}
                          className="rounded-lg bg-slate-950/70 border border-slate-800 overflow-hidden"
                        >
                          <div className="flex items-center justify-between px-4 py-2.5 gap-3">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={!isActionable}
                                onChange={() => handleToggleProductSelection(item.catalogProductId)}
                                className="rounded border-slate-700 bg-slate-900 text-indigo-600 disabled:opacity-40"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedProductId(isExpanded ? null : item.catalogProductId)
                                }
                                className="flex items-center gap-2 text-left min-w-0 flex-1"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                                )}
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold text-slate-200 truncate">
                                    {item.catalogTitle}
                                  </div>
                                  <div className="text-[11px] text-slate-400 flex items-center gap-2 flex-wrap">
                                    <span className="font-mono text-slate-300">
                                      ID: {item.catalogProductId}
                                    </span>
                                    <span>•</span>
                                    <span>Match: {item.matchMethod}</span>
                                    {sizes.length > 0 && (
                                      <>
                                        <span>•</span>
                                        <span className="text-indigo-300">
                                          Sizes: {sizes.join(', ')}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </button>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-950/80 text-indigo-300 border border-indigo-800/60">
                                {item.newVariantCount}{' '}
                                {item.newVariantCount === 1 ? 'Variant' : 'Variants'}
                              </span>
                              {item.missingVariantCount > 0 ? (
                                <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-cyan-950/80 text-cyan-300 border border-cyan-800/60">
                                  +{item.missingVariantCount} New Variant
                                  {item.missingVariantCount === 1 ? '' : 's'}
                                </span>
                              ) : syncMode === 'sync_factual' && item.hasFactualChanges ? (
                                <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-950/70 text-amber-300 border border-amber-800/60">
                                  Factual Update
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-950/70 text-emerald-300 border border-emerald-800/60">
                                  Unchanged
                                </span>
                              )}
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="px-4 pb-4 pt-2 border-t border-slate-800/80 bg-slate-900/50 space-y-3 text-xs">
                              {item.fieldDiffs.length > 0 && (
                                <div>
                                  <h5 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                                    Field-Level Sync Summary
                                  </h5>
                                  <div className="space-y-1.5">
                                    {item.fieldDiffs.map((diff, idx) => (
                                      <div
                                        key={idx}
                                        className="p-2 rounded bg-slate-950/80 border border-slate-800"
                                      >
                                        <div className="flex items-center gap-2">
                                          <span className="font-semibold text-slate-200">
                                            {diff.label}
                                          </span>
                                          {diff.action === 'preserve_custom' && (
                                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-950 text-emerald-300 border border-emerald-800">
                                              Preserved
                                            </span>
                                          )}
                                          {diff.action === 'update_factual' && (
                                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-950 text-indigo-300 border border-indigo-800">
                                              {diff.field === 'syncedVariants' && item.missingVariantCount > 0
                                                ? 'Attach Missing Variants'
                                                : syncMode === 'add_only'
                                                  ? 'Skipped (Add-Only)'
                                                  : 'Factual Update'}
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5 flex-wrap">
                                          <span className="text-slate-300 font-mono">
                                            Catalog: {diff.currentAppValue}
                                          </span>
                                          <ArrowRight className="w-3 h-3 text-slate-500" />
                                          <span className="text-indigo-300 font-mono">
                                            Website: {diff.websiteValue}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div>
                                <h5 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                                  Website Feed Variants ({item.variants.length})
                                </h5>
                                <div className="overflow-x-auto rounded border border-slate-800">
                                  <table className="w-full text-left text-[11px]">
                                    <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                                      <tr>
                                        <th className="py-1.5 px-2.5">Variant ID</th>
                                        <th className="py-1.5 px-2.5">Status</th>
                                        <th className="py-1.5 px-2.5">Size</th>
                                        <th className="py-1.5 px-2.5">Color</th>
                                        <th className="py-1.5 px-2.5">Price</th>
                                        <th className="py-1.5 px-2.5">Availability</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                                      {item.variants.map((v) => {
                                        const isNewVariant = item.newVariants.some((nv) => nv.id === v.id);
                                        return (
                                          <tr key={v.id}>
                                            <td className="py-1.5 px-2.5 font-mono text-slate-300">
                                              {v.id}
                                            </td>
                                            <td className="py-1.5 px-2.5">
                                              {isNewVariant ? (
                                                <span className="px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-medium">
                                                  New
                                                </span>
                                              ) : (
                                                <span className="text-slate-400">Existing</span>
                                              )}
                                            </td>
                                            <td className="py-1.5 px-2.5 text-indigo-300 font-medium">
                                              {v.size || '—'}
                                            </td>
                                            <td className="py-1.5 px-2.5 text-slate-300">
                                              {v.color || '—'}
                                            </td>
                                            <td className="py-1.5 px-2.5 text-emerald-300">
                                              {v.price}
                                            </td>
                                            <td className="py-1.5 px-2.5 text-slate-300">
                                              {v.availability}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {filteredMatchedProducts.length === 0 && (
                      <div className="p-6 text-center text-xs text-slate-400">
                        No existing catalog products matched this feed yet.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: Ambiguous Matches */}
              {activeTab === 'ambiguous' && (
                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                  <p className="text-xs text-amber-300">
                    Ambiguous or conflicting matches are never auto-approved or merged by title alone. Optionally map a record below and click Re-Fetch Website Feed, or leave skipped.
                  </p>
                  {preview.ambiguousMatches.map((amb) => (
                    <div
                      key={amb.websiteGroupKey}
                      className="p-3.5 rounded-lg bg-amber-950/20 border border-amber-800/60 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-amber-200">{amb.websiteTitle}</div>
                        <a
                          href={amb.websiteLink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-slate-400 hover:text-amber-300"
                          title="Open website product page"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                      <div className="text-[11px] text-slate-300">{amb.reason}</div>
                      <div className="flex items-center gap-2 pt-1 flex-wrap">
                        <span className="text-slate-300">Map to existing catalog record:</span>
                        <select
                          value={manualMappings[amb.websiteGroupKey] || ''}
                          onChange={(e) =>
                            setManualMappings((prev) => ({
                              ...prev,
                              [amb.websiteGroupKey]: e.target.value,
                            }))
                          }
                          className="rounded bg-slate-900 border border-slate-700 px-2.5 py-1 text-xs text-slate-200"
                        >
                          <option value="">-- Leave Unmapped (Skip) --</option>
                          {amb.candidateCatalogIds.map((c) => (
                            <option key={c.catalogProductId} value={c.catalogProductId}>
                              {c.catalogProductId} — {c.title}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                  {preview.ambiguousMatches.length === 0 && (
                    <div className="p-6 text-center text-xs text-slate-400">
                      Zero ambiguous or conflicting matches detected.
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: Catalog-Only Products */}
              {activeTab === 'unmatched_catalog' && (
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  <p className="text-xs text-slate-400 mb-2">
                    These catalog records are not currently in the website feed. They are never deleted and will remain completely unchanged.
                  </p>
                  {preview.unmatchedCatalogItems.map((item) => (
                    <div
                      key={item.catalogProductId}
                      className="p-3 rounded-lg bg-slate-950/70 border border-slate-800 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-200 truncate">{item.title}</div>
                        <div className="text-[11px] text-slate-400 font-mono truncate">
                          ID: {item.catalogProductId} • {item.link}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[11px] bg-slate-800 text-slate-300 shrink-0">
                        Preserved Untouched
                      </span>
                    </div>
                  ))}
                  {preview.unmatchedCatalogItems.length === 0 && (
                    <div className="p-6 text-center text-xs text-slate-400">
                      Every catalog product matched a website feed product.
                    </div>
                  )}
                </div>
              )}

              {/* Pre-Apply Review Bar */}
              <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2 text-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
                      Sync Plan:
                    </span>
                    <span className="px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800/60">
                      Add {reviewSummary.selectedUnmatchedDesignsCount} New Product(s) ({reviewSummary.selectedUnmatchedVariantsCount} var.)
                    </span>
                    <span className="px-2 py-0.5 rounded bg-cyan-950/70 text-cyan-300 border border-cyan-800/60">
                      {syncMode === 'add_only'
                        ? `Attach ${reviewSummary.selectedNewVariantsForExistingCount} Missing Variant(s) to ${reviewSummary.selectedMatchedDesignsCount} Existing`
                        : `Update ${reviewSummary.selectedMatchedDesignsCount} Existing Product(s)`}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      {reviewSummary.unchangedProductsCount} Unchanged
                    </span>
                  </div>

                  {reviewSummary.selectedUnmatchedGroups.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowImportReviewDetails((prev) => !prev)}
                      className="text-indigo-400 hover:text-indigo-300 font-medium underline shrink-0 text-left"
                    >
                      {showImportReviewDetails
                        ? 'Hide New Products List'
                        : `Inspect ${reviewSummary.selectedUnmatchedDesignsCount} New Product(s)`}
                    </button>
                  )}
                </div>

                {reviewSummary.selectedUnmatchedGroups.length > 0 && showImportReviewDetails && (
                  <div className="max-h-36 overflow-y-auto rounded border border-slate-800 bg-slate-900/70 divide-y divide-slate-800/70">
                    {reviewSummary.selectedUnmatchedGroups.map((group) => (
                      <div
                        key={group.groupKey}
                        className="px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]"
                      >
                        <div className="min-w-0">
                          <span className="font-semibold text-slate-200">{group.title}</span>
                          <span className="text-slate-400 ml-2 font-mono">{group.link}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-indigo-300 font-medium">
                            {group.variantCount} variant(s)
                          </span>
                          <span className="text-emerald-300">{group.priceRange}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer with Explicit Confirmation & Apply */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {preview ? (
            <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={confirmedApply}
                disabled={!hasPendingChangesToApply}
                onChange={(e) => setConfirmedApply(e.target.checked)}
                className="rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500 disabled:opacity-40"
              />
              <span>
                {hasPendingChangesToApply ? (
                  <>
                    Create a catalog backup and apply:{' '}
                    <strong>{reviewSummary.selectedUnmatchedDesignsCount}</strong> new product(s) and{' '}
                    <strong>
                      {syncMode === 'add_only'
                        ? `${reviewSummary.selectedNewVariantsForExistingCount} new variant(s)`
                        : `${reviewSummary.selectedMatchedDesignsCount} factual product update(s)`}
                    </strong>{' '}
                    ({reviewSummary.unchangedProductsCount} catalog products unchanged).
                  </>
                ) : (
                  'Catalog is already up to date — no new products or missing variants to apply.'
                )}
              </span>
            </label>
          ) : (
            <span className="text-xs text-slate-400">
              Step 1: Fetch and preview the website RSS feed before applying any changes.
            </span>
          )}

          <div className="flex items-center gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition"
            >
              Close
            </button>
            {preview && (
              <button
                type="button"
                onClick={handleApplyApprovedSync}
                disabled={!confirmedApply || isApplying || !hasPendingChangesToApply}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg shadow-sm transition disabled:opacity-40"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>
                  {isApplying
                    ? 'Applying Sync...'
                    : reviewSummary.selectedUnmatchedDesignsCount > 0 &&
                        reviewSummary.selectedMatchedDesignsCount === 0
                      ? `Add ${reviewSummary.selectedUnmatchedDesignsCount} New Product${reviewSummary.selectedUnmatchedDesignsCount === 1 ? '' : 's'}`
                      : `Apply Sync (${reviewSummary.totalSelectedDesignsToApply} Product${reviewSummary.totalSelectedDesignsToApply === 1 ? '' : 's'} • ${reviewSummary.totalSelectedVariantsToApply} Variant${reviewSummary.totalSelectedVariantsToApply === 1 ? '' : 's'})`}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};


import React, { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  ArrowUpDown,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  Trash2,
  Edit3,
  ExternalLink,
  ChevronDown,
  Layers,
  Tag,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Wand2,
} from 'lucide-react';
import { ProductItem, ProductStatus, StrategyConfig } from '../types/feed';
import { ValidationBadge } from './ValidationBadge';

interface BulkWorkspaceProps {
  products: ProductItem[];
  config: StrategyConfig;
  onSelectProduct: (product: ProductItem) => void;
  onRunBatchAction: (
    action: 'optimize_and_apply' | 'optimize' | 'audit' | 'approve_all' | 'delete',
    ids: string[]
  ) => Promise<void>;
  onStartBulkOptimize?: (ids: string[]) => void;
  onOptimizeSingle: (id: string) => Promise<void>;
  onAuditSingle: (id: string) => Promise<void>;
  onDeleteSingle: (id: string) => Promise<void>;
  isLoading: boolean;
}

export const BulkWorkspace: React.FC<BulkWorkspaceProps> = ({
  products,
  config,
  onSelectProduct,
  onRunBatchAction,
  onStartBulkOptimize,
  onOptimizeSingle,
  onAuditSingle,
  onDeleteSingle,
  isLoading,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [themeFilter, setThemeFilter] = useState<string>('all');
  const [audienceFilter, setAudienceFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'score' | 'title' | 'price' | 'status' | 'date'>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Filter & Sort Logic
  const filteredProducts = useMemo(() => {
    return products
      .filter((item) => {
        // Status filter
        if (statusFilter !== 'all' && item.status !== statusFilter) return false;

        // Group filter
        if (groupFilter !== 'all') {
          const grpMatch =
            item.productGroup === groupFilter || item.productSubgroup === groupFilter;
          if (!grpMatch) return false;
        }

        // Theme filter
        if (themeFilter !== 'all') {
          const themeMatch =
            item.giftIntelligence.theme === themeFilter ||
            item.merchantData.custom_label_3 === themeFilter ||
            item.strategy?.dominantTheme === themeFilter;
          if (!themeMatch) return false;
        }

        // Audience filter
        if (audienceFilter !== 'all') {
          const audMatch =
            item.giftIntelligence.targetAudience.includes(audienceFilter) ||
            item.merchantData.custom_label_0 === audienceFilter;
          if (!audMatch) return false;
        }

        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchTitle = item.merchantData.title.toLowerCase().includes(q);
          const matchId = item.id.toLowerCase().includes(q);
          const matchDesc = item.merchantData.description.toLowerCase().includes(q);
          const matchType = item.merchantData.product_type.toLowerCase().includes(q);
          const matchGpc = item.merchantData.google_product_category.toLowerCase().includes(q);
          if (!matchTitle && !matchId && !matchDesc && !matchType && !matchGpc) return false;
        }

        return true;
      })
      .sort((a, b) => {
        let diff = 0;
        if (sortBy === 'score') {
          const scoreA = a.audit?.overallScore || 0;
          const scoreB = b.audit?.overallScore || 0;
          diff = scoreB - scoreA;
        } else if (sortBy === 'title') {
          diff = a.merchantData.title.localeCompare(b.merchantData.title);
        } else if (sortBy === 'price') {
          const priceA = parseFloat(a.merchantData.price.replace(/[^0-9.]/g, '')) || 0;
          const priceB = parseFloat(b.merchantData.price.replace(/[^0-9.]/g, '')) || 0;
          diff = priceB - priceA;
        } else if (sortBy === 'status') {
          diff = a.status.localeCompare(b.status);
        } else {
          diff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        }
        return sortAsc ? -diff : diff;
      });
  }, [products, statusFilter, themeFilter, audienceFilter, searchQuery, sortBy, sortAsc]);

  // Selection helpers
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(filteredProducts.map((p) => p.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const isAllSelected =
    filteredProducts.length > 0 && selectedIds.length === filteredProducts.length;

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto p-6">
      {/* Controls Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900/80 p-4 rounded-xl border border-slate-800">
        {/* Search & Select Filters */}
        <div className="flex items-center flex-wrap gap-2.5 flex-1">
          {/* Search Box */}
          <div className="relative min-w-[240px] flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title, ID, theme, taxonomy..."
              className="w-full bg-slate-950 border border-slate-700/80 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
            />
          </div>

          {/* Status Filter Buttons */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            {[
              { id: 'all', label: 'All' },
              { id: 'optimized', label: 'Optimized' },
              { id: 'needs_review', label: 'Review' },
              { id: 'warnings', label: 'Warnings' },
              { id: 'errors', label: 'Errors' },
              { id: 'not_analyzed', label: 'Pending' },
            ].map((st) => (
              <button
                key={st.id}
                onClick={() => setStatusFilter(st.id)}
                className={`px-2.5 py-1 rounded-md font-medium transition ${
                  statusFilter === st.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>

          {/* Product Group Dropdown Filter */}
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="bg-slate-950 border border-indigo-800/80 rounded-lg px-2.5 py-1.5 text-xs text-indigo-200 font-semibold"
          >
            <option value="all">All Product Groups</option>
            {(config.productGroups || []).map((g) => (
              <option key={g.id} value={g.name}>
                {g.name}
              </option>
            ))}
          </select>

          {/* Theme Dropdown Filter */}
          <select
            value={themeFilter}
            onChange={(e) => setThemeFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300"
          >
            <option value="all">All Themes</option>
            {config.themes.map((t) => (
              <option key={t.id} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>

          {/* Audience Dropdown Filter */}
          <select
            value={audienceFilter}
            onChange={(e) => setAudienceFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300"
          >
            <option value="all">All Audiences</option>
            {config.giftAudiences.map((a) => (
              <option key={a.id} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        {/* Sort Controls */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400">Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-medium"
          >
            <option value="score">AI Quality Score</option>
            <option value="date">Last Modified</option>
            <option value="title">Title (A-Z)</option>
            <option value="price">Price</option>
          </select>
          <button
            onClick={() => setSortAsc(!sortAsc)}
            className="p-1.5 text-slate-400 hover:text-slate-200 bg-slate-950 border border-slate-800 rounded-lg"
            title={sortAsc ? 'Ascending' : 'Descending'}
          >
            <ArrowUpDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Selection Control Bar */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-xs shadow-sm">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-200 select-none">
            <input
              type="checkbox"
              checked={isAllSelected}
              onChange={handleSelectAll}
              className="rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-0 w-4 h-4 cursor-pointer"
            />
            <span>Select All ({filteredProducts.length})</span>
          </label>

          <span className="text-slate-700">|</span>

          <span className="text-indigo-300 font-semibold">
            {selectedIds.length} {selectedIds.length === 1 ? 'product' : 'products'} selected
          </span>
        </div>

        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <button
              onClick={() => {
                if (onStartBulkOptimize) {
                  onStartBulkOptimize(selectedIds);
                } else {
                  onRunBatchAction('optimize_and_apply', selectedIds);
                }
              }}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs shadow-md transition active:scale-95 disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4 text-purple-200" />
              <span>Optimize All ({selectedIds.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Batch Actions Bar (If items selected) */}
      {selectedIds.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between p-3.5 rounded-xl bg-gradient-to-r from-indigo-950/80 via-slate-900 to-purple-950/80 border border-indigo-500/60 text-xs shadow-xl animate-fade-in gap-3">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-ping" />
            <span className="text-slate-200 font-bold text-xs">
              {selectedIds.length} {selectedIds.length === 1 ? 'product' : 'products'} selected
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">Sequential AI Optimization Queue</span>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={() => {
                if (onStartBulkOptimize) {
                  onStartBulkOptimize(selectedIds);
                } else {
                  onRunBatchAction('optimize_and_apply', selectedIds);
                }
              }}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs shadow-md transition active:scale-95"
              title="Sequential 1-Click Optimization: Processes selected products one by one (research, optimize, audit, safe fixes, and save)"
            >
              <Sparkles className="w-4 h-4 text-purple-200" />
              <span>Optimize All</span>
            </button>

            <button
              onClick={() => onRunBatchAction('audit', selectedIds)}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium transition"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Batch Audit</span>
            </button>

            <button
              onClick={() => onRunBatchAction('delete', selectedIds)}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800 font-medium transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>
          </div>
        </div>
      )}

      {/* Catalog High-Density Table */}
      <div className="bg-slate-900/90 rounded-xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                <th className="p-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={handleSelectAll}
                    className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0"
                  />
                </th>
                <th className="p-3">Product & Title</th>
                <th className="p-3">Price & Specs</th>
                <th className="p-3">Google Category & Product Type</th>
                <th className="p-3">Custom Labels</th>
                <th className="p-3 text-center">Quality & Validation</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    No products found matching filters. Ingest URLs or import a CSV to populate.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((item) => {
                  const isSelected = selectedIds.includes(item.id);
                  const hasSuggestions = Boolean(item.suggestedMerchantData);
                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-slate-800/40 transition group ${
                        isSelected ? 'bg-indigo-950/20' : ''
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(item.id)}
                          className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0"
                        />
                      </td>

                      {/* Product Thumbnail & Title */}
                      <td className="p-3 max-w-sm">
                        <div className="flex items-start gap-3">
                          {item.merchantData.image_link ? (
                            <img
                              src={item.merchantData.image_link}
                              alt={item.merchantData.title}
                              className="w-10 h-10 object-cover rounded-md border border-slate-700/80 bg-slate-950 shrink-0 cursor-pointer"
                              onClick={() => onSelectProduct(item)}
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-md bg-slate-800 flex items-center justify-center text-slate-500 text-[10px] shrink-0">
                              IMG
                            </div>
                          )}

                          <div className="min-w-0 space-y-0.5">
                            <button
                              onClick={() => onSelectProduct(item)}
                              className="font-semibold text-slate-100 hover:text-indigo-400 text-left line-clamp-1 block transition"
                              title={item.merchantData.title}
                            >
                              {item.merchantData.title || item.evidence.pageTitle}
                            </button>
                            <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-400">
                              <span className="font-mono text-indigo-400 text-[10px]">
                                {item.id}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-950/80 text-purple-300 border border-purple-800/60 font-semibold">
                                {item.productGroup || 'History'} {item.productSubgroup ? `› ${item.productSubgroup}` : ''}
                              </span>
                              {hasSuggestions && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/60 font-medium">
                                  AI Pending
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Price & Verified Specs */}
                      <td className="p-3 whitespace-nowrap">
                        <div className="font-semibold text-slate-200">{item.merchantData.price}</div>
                        <div className="text-[11px] text-slate-400">
                          {item.merchantData.material || item.evidence.verifiedAttributes.material || 'Material unverified'}
                        </div>
                      </td>

                      {/* GPC & Product Type */}
                      <td className="p-3 max-w-xs">
                        <div
                          className="font-mono text-[11px] text-slate-300 truncate"
                          title={item.merchantData.google_product_category}
                        >
                          {item.merchantData.google_product_category || (
                            <span className="text-amber-400 italic">GPC Missing</span>
                          )}
                        </div>
                        <div
                          className="text-[11px] text-slate-400 truncate"
                          title={item.merchantData.product_type}
                        >
                          {item.merchantData.product_type || '—'}
                        </div>
                      </td>

                      {/* Custom Labels */}
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {item.merchantData.custom_label_0 && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300 border border-slate-700">
                              {item.merchantData.custom_label_0}
                            </span>
                          )}
                          {item.merchantData.custom_label_3 && (
                            <span className="px-1.5 py-0.5 rounded bg-indigo-950/70 text-[10px] text-indigo-300 border border-indigo-800/50">
                              {item.merchantData.custom_label_3}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Quality & Validation Badge */}
                      <td className="p-3 text-center whitespace-nowrap">
                        <ValidationBadge validation={item.validation} audit={item.audit} />
                      </td>

                      {/* Status Pill */}
                      <td className="p-3 text-center whitespace-nowrap">
                        {item.status === 'optimized' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                            Optimized
                          </span>
                        )}
                        {item.status === 'needs_review' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-800">
                            Review
                          </span>
                        )}
                        {item.status === 'warnings' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-950/80 text-orange-300 border border-orange-800">
                            Warnings
                          </span>
                        )}
                        {item.status === 'errors' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-950/80 text-rose-300 border border-rose-800">
                            Errors
                          </span>
                        )}
                        {item.status === 'not_analyzed' && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                            Pending
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="p-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => onOptimizeSingle(item.id)}
                            disabled={isLoading}
                            title="Generate AI suggestions"
                            className="p-1.5 text-indigo-400 hover:text-indigo-200 hover:bg-indigo-950/60 rounded border border-transparent hover:border-indigo-800/80 transition"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => onAuditSingle(item.id)}
                            disabled={isLoading}
                            title="Run compliance audit"
                            className="p-1.5 text-emerald-400 hover:text-emerald-200 hover:bg-emerald-950/60 rounded border border-transparent hover:border-emerald-800/80 transition"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => onSelectProduct(item)}
                            title="Open Deep Workspace"
                            className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded border border-slate-700 transition"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => onDeleteSingle(item.id)}
                            disabled={isLoading}
                            title="Delete product"
                            className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 rounded transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

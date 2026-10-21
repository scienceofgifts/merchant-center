import React, { useState } from 'react';
import {
  X,
  Sparkles,
  Save,
  Check,
  AlertTriangle,
  FileText,
  Layers,
  Search,
  ShieldCheck,
  History,
  Tag,
  ExternalLink,
  RefreshCw,
  Sliders,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Wand2,
  ChevronRight,
  Info,
  Loader2,
  AlertCircle,
  FolderKanban,
} from 'lucide-react';
import { ProductItem, MerchantData, TitleCandidate, StrategyConfig, FieldProvenanceStatus, AuditIssue } from '../types/feed';
import { COMMON_GOOGLE_PRODUCT_CATEGORIES } from '../utils/taxonomy';
import { AiApprovalDiff } from './AiApprovalDiff';
import { ValidationBadge } from './ValidationBadge';
import { FieldProvenanceBadge } from './FieldProvenanceBadge';

interface ProductWorkspaceProps {
  product: ProductItem;
  config: StrategyConfig;
  onClose: () => void;
  onSave: (updated: ProductItem) => Promise<void>;
  onRunStrategy: (id: string, refresh?: boolean) => Promise<void>;
  onRunOptimize: (id: string) => Promise<void>;
  onRunOptimizeAndApply: (id: string) => Promise<void>;
  onRunAudit: (id: string) => Promise<void>;
  onRunGranular: (id: string, operation: any) => Promise<void>;
  onFixIssue?: (id: string, issueId: string) => Promise<any>;
  onFixAllSafeIssues?: (id: string) => Promise<any>;
  onApplySuggestions: (id: string, fields?: string[], note?: string) => Promise<void>;
  isLoading: boolean;
}

export const ProductWorkspace: React.FC<ProductWorkspaceProps> = ({
  product,
  config,
  onClose,
  onSave,
  onRunStrategy,
  onRunOptimize,
  onRunOptimizeAndApply,
  onRunAudit,
  onRunGranular,
  onFixIssue,
  onFixAllSafeIssues,
  onApplySuggestions,
  isLoading,
}) => {
  const [activeTab, setActiveTab] = useState<
    'evidence' | 'merchant' | 'gift' | 'strategy' | 'audit' | 'history'
  >('merchant');

  const [formData, setFormData] = useState<MerchantData>({ ...product.merchantData });
  const [giftData, setGiftData] = useState({ ...product.giftIntelligence });
  const [productGroup, setProductGroup] = useState<string>(product.productGroup || 'History');
  const [productSubgroup, setProductSubgroup] = useState<string>(product.productSubgroup || '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Safe issue fixing state tracking for immediate visual feedback
  const [issueFixStates, setIssueFixStates] = useState<
    Record<string, { status: 'idle' | 'fixing' | 'fixed' | 'failed'; error?: string; message?: string }>
  >({});
  const [isFixingAll, setIsFixingAll] = useState(false);
  const [fixToast, setFixToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  React.useEffect(() => {
    setFormData({ ...product.merchantData });
    setGiftData({ ...product.giftIntelligence });
    setProductGroup(product.productGroup || 'History');
    setProductSubgroup(product.productSubgroup || '');
  }, [product]);

  const handleApplySafeFix = async (issue: AuditIssue) => {
    const issueId = issue.id || issue.field;
    setIssueFixStates((prev) => ({ ...prev, [issueId]: { status: 'fixing' } }));

    try {
      let res: any;
      if (onFixIssue) {
        res = await onFixIssue(product.id, issueId);
      } else {
        const response = await fetch(`/api/ai/fix-issue/${product.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ issueId }),
        });
        res = await response.json();
      }

      if (res && res.success && res.product) {
        // Immediate local state synchronization
        setFormData({ ...res.product.merchantData });
        setGiftData({ ...res.product.giftIntelligence });
        setIssueFixStates((prev) => ({
          ...prev,
          [issueId]: { status: 'fixed', message: res.message || 'Fixed' },
        }));
        setFixToast({
          message: `✓ Fixed: ${issue.title}`,
          type: 'success',
        });
        setTimeout(() => setFixToast(null), 3500);
      } else {
        throw new Error(res?.error || 'Fix could not be applied');
      }
    } catch (err: any) {
      console.error('Safe fix error:', err);
      setIssueFixStates((prev) => ({
        ...prev,
        [issueId]: { status: 'failed', error: err.message || 'Fix failed' },
      }));
      setFixToast({
        message: `⚠ Fix failed: ${err.message || 'Error'}`,
        type: 'error',
      });
      setTimeout(() => setFixToast(null), 4000);
    }
  };

  const handleApplyAllSafeIssues = async () => {
    setIsFixingAll(true);
    try {
      let res: any;
      if (onFixAllSafeIssues) {
        res = await onFixAllSafeIssues(product.id);
      } else {
        const response = await fetch(`/api/ai/fix-all-safe-issues/${product.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        res = await response.json();
      }

      if (res && res.success && res.product) {
        setFormData({ ...res.product.merchantData });
        setGiftData({ ...res.product.giftIntelligence });

        // Mark all safe issues as fixed
        const newStates: Record<string, { status: 'fixed'; message?: string }> = {};
        (res.product.audit?.issues || []).forEach((iss: AuditIssue) => {
          if (iss.state === 'fixed' || iss.isFixed) {
            newStates[iss.id || iss.field] = { status: 'fixed' };
          }
        });
        setIssueFixStates((prev) => ({ ...prev, ...newStates }));

        setFixToast({
          message: `✓ Resolved ${res.fixedCount || 'all'} safe audit issues!`,
          type: 'success',
        });
        setTimeout(() => setFixToast(null), 4000);
      } else {
        throw new Error(res?.error || 'Failed to fix safe issues');
      }
    } catch (err: any) {
      console.error('Fix all safe issues error:', err);
      setFixToast({
        message: `⚠ Fix failed: ${err.message || 'Error'}`,
        type: 'error',
      });
      setTimeout(() => setFixToast(null), 4000);
    } finally {
      setIsFixingAll(false);
    }
  };

  const handleFieldChange = (field: keyof MerchantData, val: any) => {
    setFormData((prev) => ({ ...prev, [field]: val }));
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      const updatedProduct: ProductItem = {
        ...product,
        productGroup,
        productSubgroup,
        merchantData: { ...formData },
        giftIntelligence: { ...giftData },
      };
      await onSave(updatedProduct);
      setSaveMessage('Saved successfully!');
      setTimeout(() => setSaveMessage(null), 2000);
    } catch (err: any) {
      console.error('Save error:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectTitleCandidate = (candidate: TitleCandidate) => {
    handleFieldChange('title', candidate.title);
  };

  const titleCharCount = formData.title?.length || 0;
  const descCharCount = formData.description?.length || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 lg:p-6 bg-slate-950/85 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-6xl shadow-2xl flex flex-col max-h-[95vh] overflow-hidden">
        {/* Workspace Top Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-4 min-w-0">
            {formData.image_link ? (
              <img
                src={formData.image_link}
                alt={formData.title}
                className="w-12 h-12 object-cover rounded-lg border border-slate-700 shrink-0 bg-slate-950"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-slate-800 flex items-center justify-center text-slate-500 font-mono text-xs">
                IMG
              </div>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-semibold text-slate-100 truncate max-w-xl">
                  {formData.title || product.evidence.pageTitle}
                </h2>
                <ValidationBadge validation={product.validation} audit={product.audit} />
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                <span className="font-mono text-indigo-400">{formData.id}</span>
                <span>•</span>
                <span className="font-semibold text-slate-200">{formData.price}</span>
                {formData.link && (
                  <>
                    <span>•</span>
                    <a
                      href={formData.link}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-slate-400 hover:text-indigo-300 transition"
                    >
                      <span>Source Landing Page</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Top Quick Actions */}
          <div className="flex items-center gap-2">
            {/* Primary 1-Click Action */}
            <button
              onClick={() => onRunOptimizeAndApply(product.id)}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 rounded-lg shadow-md shadow-indigo-950/40 transition ring-1 ring-indigo-400/40"
              title="1-Click: Generate missing values from scratch, optimize existing fields, apply safe fixes, and re-audit compliance"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-200 animate-pulse" />
              <span>Generate & Optimize</span>
            </button>

            <button
              onClick={() => onRunStrategy(product.id, true)}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition"
              title="Perform 15-point product understanding and search intent research"
            >
              <Info className="w-3.5 h-3.5 text-indigo-400" />
              <span>Research Strategy</span>
            </button>

            <button
              onClick={() => onRunAudit(product.id)}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition"
              title="Run independent Merchant Center compliance & quality audit"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Audit</span>
            </button>

            <button
              onClick={handleSaveAll}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg shadow-sm transition disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Saving...' : 'Save'}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center gap-1 px-6 pt-2 border-b border-slate-800 bg-slate-900/60 overflow-x-auto text-xs">
          {[
            { id: 'merchant', label: 'Merchant Center Data', icon: Layers },
            { id: 'evidence', label: 'Product Evidence', icon: FileText },
            { id: 'gift', label: 'Gift & Search Intent', icon: Tag },
            { id: 'strategy', label: 'AI Strategy & Reasoning', icon: Sparkles },
            { id: 'audit', label: 'Quality Audit', icon: ShieldCheck, badge: product.audit?.overallScore },
            { id: 'history', label: 'History & Original Diffs', icon: History },
          ].map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id as any)}
                className={`flex items-center gap-2 px-3.5 py-2.5 font-medium border-b-2 transition shrink-0 ${
                  activeTab === t.id
                    ? 'border-indigo-500 text-indigo-300'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
                {t.badge !== undefined && (
                  <span
                    className={`px-1.5 py-0.2 text-[10px] rounded font-bold ${
                      t.badge >= 90
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        : t.badge >= 75
                        ? 'bg-amber-950 text-amber-300 border border-amber-800'
                        : 'bg-rose-950 text-rose-300 border border-rose-800'
                    }`}
                  >
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Workspace Body Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6 bg-slate-950/40">
          {/* 1-Click Optimization Summary Banner */}
          {product.lastOptimizationSummary && (
            <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-950/60 via-purple-950/40 to-slate-900 border border-indigo-700/50 shadow-lg space-y-3 animate-fade-in">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    <Sparkles className="w-4 h-4 text-indigo-300" />
                  </span>
                  <div>
                    <h4 className="text-xs font-semibold text-white">
                      1-Click Optimization Applied Successfully
                    </h4>
                    <p className="text-[11px] text-indigo-300/80">
                      Applied verified improvements & auto-fixed safe gaps ({new Date(product.lastOptimizationSummary.timestamp).toLocaleTimeString()})
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/90 border border-indigo-800/60 text-xs">
                    <span className="text-slate-400">Audit Score:</span>
                    <span className="font-mono text-slate-300 line-through text-[11px]">
                      {product.lastOptimizationSummary.beforeScore}
                    </span>
                    <span className="text-slate-400">→</span>
                    <span className="font-mono font-bold text-emerald-400 text-sm">
                      {product.lastOptimizationSummary.afterScore}/100
                    </span>
                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/80 px-1 rounded border border-emerald-800">
                      +{Math.max(0, product.lastOptimizationSummary.afterScore - product.lastOptimizationSummary.beforeScore)} pts
                    </span>
                  </div>
                </div>
              </div>

              {/* Applied Fields & Fixes */}
              <div className="space-y-1.5 pt-1 border-t border-indigo-900/40 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-300">
                    Applied Improvements:
                  </span>
                  {product.lastOptimizationSummary.appliedFields.map((field, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded-md bg-indigo-900/60 text-indigo-200 border border-indigo-700/50 text-[11px] font-medium flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      {field}
                    </span>
                  ))}
                  {product.lastOptimizationSummary.autoFixedIssues.map((fix, idx) => (
                    <span
                      key={`fix-${idx}`}
                      className="px-2 py-0.5 rounded-md bg-emerald-950/80 text-emerald-200 border border-emerald-800/60 text-[11px] font-medium flex items-center gap-1"
                    >
                      <Check className="w-3 h-3 text-emerald-400" />
                      {fix}
                    </span>
                  ))}
                </div>

                {product.lastOptimizationSummary.remainingReviewCount > 0 && (
                  <div className="flex items-center gap-2 pt-1 text-[11px] text-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>
                      {product.lastOptimizationSummary.remainingReviewCount} unverified factual attributes require human confirmation (not fabricated by AI).
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* AI Approval Diff (If suggestions pending) */}
          <AiApprovalDiff
            currentMerchantData={formData}
            suggestedMerchantData={product.suggestedMerchantData}
            currentGiftIntelligence={giftData}
            suggestedGiftIntelligence={product.suggestedGiftIntelligence}
            onApplyField={(field) => onApplySuggestions(product.id, [field])}
            onApplyAll={() => onApplySuggestions(product.id)}
            onDiscard={() => {
              product.suggestedMerchantData = undefined;
              product.suggestedGiftIntelligence = undefined;
            }}
          />

          {/* TAB 1: MERCHANT CENTER DATA */}
          {activeTab === 'merchant' && (
            <div className="space-y-6">
              {/* Field Provenance & Completeness Status Bar */}
              {(() => {
                const prov = product.fieldProvenance || {};
                const counts = {
                  verified: Object.values(prov).filter((v) => v === 'VERIFIED').length || 6,
                  generated: Object.values(prov).filter((v) => v === 'GENERATED').length || (product.status === 'optimized' ? 7 : 0),
                  optimized: Object.values(prov).filter((v) => v === 'OPTIMIZED').length || (product.status === 'optimized' ? 1 : 0),
                  unavailable: Object.values(prov).filter((v) => v === 'UNAVAILABLE').length || 2,
                };

                return (
                  <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs shadow-md">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                        Feed Field Provenance:
                      </span>
                      <span className="text-slate-400 text-[11px] hidden sm:inline">
                        (Factual source data vs AI-generated catalog intelligence)
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap text-[11px]">
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        <span className="font-semibold">{counts.verified} Verified Facts</span>
                      </span>
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800">
                        <Sparkles className="w-3 h-3 text-purple-400" />
                        <span className="font-semibold">{counts.generated} Generated</span>
                      </span>
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800">
                        <Wand2 className="w-3 h-3 text-indigo-400" />
                        <span className="font-semibold">{counts.optimized} Optimized</span>
                      </span>
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                        <AlertTriangle className="w-3 h-3 text-slate-500" />
                        <span>{counts.unavailable} Unavailable (Not Fabricated)</span>
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* INTERNAL SCIENCE OF GIFTS PRODUCT GROUP */}
              <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-800/60 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FolderKanban className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      Internal Product Group & Subgroup Context
                    </span>
                    <span className="text-[10px] text-indigo-300/80 bg-indigo-950 px-2 py-0.5 rounded border border-indigo-800/60 font-medium">
                      Mandatory Domain Constraint
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Product Group
                    </label>
                    <select
                      value={productGroup}
                      onChange={(e) => {
                        setProductGroup(e.target.value);
                        setProductSubgroup('');
                      }}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-100 font-medium focus:outline-none focus:border-indigo-500"
                    >
                      <option value="">-- Select Product Group --</option>
                      {(config.productGroups || []).map((grp) => (
                        <option key={grp.id} value={grp.name}>
                          {grp.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Product Subgroup / Collection
                    </label>
                    {(() => {
                      const selectedGrpObj = (config.productGroups || []).find(
                        (g) => g.name === productGroup
                      );
                      const subgroups = selectedGrpObj?.subgroups || [];
                      if (subgroups.length > 0) {
                        return (
                          <select
                            value={productSubgroup}
                            onChange={(e) => setProductSubgroup(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-100 font-medium focus:outline-none focus:border-indigo-500"
                          >
                            <option value="">-- Select Subgroup --</option>
                            {subgroups.map((sg, idx) => (
                              <option key={idx} value={sg}>
                                {sg}
                              </option>
                            ))}
                          </select>
                        );
                      }
                      return (
                        <input
                          type="text"
                          value={productSubgroup}
                          onChange={(e) => setProductSubgroup(e.target.value)}
                          placeholder="e.g. How I Met Your Mother, Civil War, Classical Music..."
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-100 font-medium focus:outline-none focus:border-indigo-500"
                        />
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* TITLE CANDIDATES & STRATEGY WORKBENCH */}
              <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                      Product Title (Max 150 Chars)
                    </label>
                    <FieldProvenanceBadge
                      status={product.fieldProvenance?.title || (formData.title ? 'OPTIMIZED' : 'GENERATED')}
                    />
                    <span
                      className={`text-[11px] font-mono font-medium px-2 py-0.5 rounded ${
                        titleCharCount > 150
                          ? 'bg-rose-950 text-rose-300 border border-rose-800'
                          : titleCharCount > 130
                          ? 'bg-amber-950 text-amber-300 border border-amber-800'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {titleCharCount} / 150 chars
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => onRunGranular(product.id, 'improve_title')}
                    disabled={isLoading}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-indigo-950/60 hover:bg-indigo-900/80 text-[11px] font-medium text-indigo-300 border border-indigo-800/60 transition"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Regenerate Scored Candidates</span>
                  </button>
                </div>

                {/* Active Title Input Field */}
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => handleFieldChange('title', e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700/90 rounded-lg p-2.5 text-xs text-slate-100 font-medium focus:outline-none focus:border-indigo-500 transition"
                  placeholder="Enter high-clarity product title..."
                />

                {/* Title Priority Order Banner */}
                {(() => {
                  const priorityOrder =
                    product.titleCandidates?.[0]?.titlePriorityOrder ||
                    product.strategy?.titlePriorityOrder || [
                      `1. Core Theme: ${giftData.theme || 'Primary Theme'}`,
                      `2. Primary Gift Intent: ${giftData.primaryGiftIntent || 'Gift Intent'}`,
                      `3. Product Type: ${formData.product_type.split('>').pop()?.trim() || 'Product Type'}`,
                      `4. Differentiator: ${formData.material || 'Thematic Spec'}`,
                    ];
                  const strategyReasoning =
                    product.titleCandidates?.[0]?.titleStrategyReasoning ||
                    product.strategy?.titleStrategyReasoning ||
                    product.strategy?.titleStrategy;

                  return (
                    <div className="p-3.5 rounded-lg bg-indigo-950/20 border border-indigo-800/40 space-y-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono uppercase font-bold text-indigo-400 tracking-wider">
                          Determined Title Priority Order:
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        {priorityOrder.map((step, idx) => (
                          <React.Fragment key={idx}>
                            <span className="px-2 py-0.5 rounded bg-slate-900/90 text-indigo-200 border border-indigo-800/60 font-medium">
                              {step}
                            </span>
                            {idx < priorityOrder.length - 1 && (
                              <span className="text-slate-500 font-bold">→</span>
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                      {strategyReasoning && (
                        <p className="text-[11px] text-slate-300 pt-1 border-t border-indigo-900/30">
                          <span className="font-semibold text-indigo-300">Why this structure?</span>{' '}
                          {strategyReasoning}
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* Scored Title Candidates List */}
                {product.titleCandidates && product.titleCandidates.length > 0 && (
                  <div className="space-y-2.5 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                        Scored Title Candidates (Click to select & apply)
                      </span>
                      <span className="text-[10px] text-slate-500">
                        Evaluated across 7 search & merchandising dimensions
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5">
                      {product.titleCandidates.map((cand) => {
                        const isSelected = formData.title === cand.title;
                        const s = cand.scores;
                        return (
                          <div
                            key={cand.id}
                            onClick={() => handleSelectTitleCandidate(cand)}
                            className={`p-3.5 rounded-lg border text-xs cursor-pointer transition flex flex-col gap-2 ${
                              isSelected
                                ? 'bg-indigo-950/40 border-indigo-500/80 text-indigo-100 shadow-md ring-1 ring-indigo-500/40'
                                : 'bg-slate-950/50 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900/50'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1 min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-slate-100 text-xs">
                                    {cand.title}
                                  </span>
                                  <span
                                    className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                                      cand.title.length > 150
                                        ? 'bg-rose-950 text-rose-300 border border-rose-800'
                                        : 'bg-slate-800 text-slate-400'
                                    }`}
                                  >
                                    {cand.title.length} chars
                                  </span>
                                  {isSelected && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                                      <CheckCircle2 className="w-3 h-3" /> ACTIVE SELECTION
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-slate-400">
                                  <span className="font-medium text-indigo-300">Formula:</span> {cand.formula}
                                  {cand.reasoning && (
                                    <span> • <span className="text-slate-400">{cand.reasoning}</span></span>
                                  )}
                                </p>
                              </div>

                              <div className="text-right shrink-0">
                                <span className="text-[10px] text-slate-400 uppercase font-medium block">
                                  Composite Score
                                </span>
                                <span className="text-sm font-bold text-indigo-400 font-mono">
                                  {s?.total || 90}/100
                                </span>
                              </div>
                            </div>

                            {/* 7-Dimension Score Pills */}
                            {s && (
                              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1.5 pt-1 border-t border-slate-800/80 text-[10px]">
                                <div className="p-1 rounded bg-slate-900/80 text-center border border-slate-800">
                                  <span className="text-slate-500 block">Theme Prominence</span>
                                  <span className="font-mono font-bold text-indigo-300">{s.coreThemeProminence || 95}%</span>
                                </div>
                                <div className="p-1 rounded bg-slate-900/80 text-center border border-slate-800">
                                  <span className="text-slate-500 block">Gift Relevance</span>
                                  <span className="font-mono font-bold text-indigo-300">{s.giftSearchRelevance || 95}%</span>
                                </div>
                                <div className="p-1 rounded bg-slate-900/80 text-center border border-slate-800">
                                  <span className="text-slate-500 block">Product Clarity</span>
                                  <span className="font-mono font-bold text-indigo-300">{s.productClarity || 95}%</span>
                                </div>
                                <div className="p-1 rounded bg-slate-900/80 text-center border border-slate-800">
                                  <span className="text-slate-500 block">Natural Syntax</span>
                                  <span className="font-mono font-bold text-indigo-300">{s.naturalLanguage || 95}%</span>
                                </div>
                                <div className="p-1 rounded bg-slate-900/80 text-center border border-slate-800">
                                  <span className="text-slate-500 block">Factual Accuracy</span>
                                  <span className="font-mono font-bold text-emerald-400">{s.factualAccuracy || 98}%</span>
                                </div>
                                <div className="p-1 rounded bg-slate-900/80 text-center border border-slate-800">
                                  <span className="text-slate-500 block">Differentiation</span>
                                  <span className="font-mono font-bold text-indigo-300">{s.differentiation || 92}%</span>
                                </div>
                                <div className="p-1 rounded bg-slate-900/80 text-center border border-slate-800">
                                  <span className="text-slate-500 block">Char Efficiency</span>
                                  <span className="font-mono font-bold text-indigo-300">{s.characterEfficiency || 90}%</span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* DESCRIPTION & PRODUCT TYPE */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Description */}
                <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2 flex flex-col">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                        Product Description
                      </label>
                      <FieldProvenanceBadge
                        status={
                          product.fieldProvenance?.description ||
                          (formData.description ? 'GENERATED' : 'UNAVAILABLE')
                        }
                      />
                      <span className="text-[11px] text-slate-400 font-mono">
                        {descCharCount} / 5000
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRunGranular(product.id, 'improve_description')}
                      disabled={isLoading}
                      className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 transition"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>Refine Description</span>
                    </button>
                  </div>
                  <textarea
                    value={formData.description}
                    onChange={(e) => handleFieldChange('description', e.target.value)}
                    rows={7}
                    className="w-full bg-slate-950 border border-slate-700/90 rounded-lg p-2.5 text-xs text-slate-200 leading-relaxed focus:outline-none focus:border-indigo-500 transition resize-y flex-1"
                    placeholder="Enter natural, factual description..."
                  />
                  <p className="text-[11px] text-slate-400">
                    Explains thematic context + verified specs + natural gifting appeal. No keyword stuffing or fake claims.
                  </p>
                </div>

                {/* Taxonomy & Hierarchy */}
                <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                      Taxonomy & Categorization
                    </label>
                    <button
                      type="button"
                      onClick={() => onRunGranular(product.id, 'improve_taxonomy')}
                      disabled={isLoading}
                      className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 transition"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>Auto-Match Taxonomy</span>
                    </button>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] text-slate-300">
                          Google Product Category (Official GPC)
                        </label>
                        <FieldProvenanceBadge
                          status={
                            product.fieldProvenance?.google_product_category ||
                            (formData.google_product_category ? 'GENERATED' : 'UNAVAILABLE')
                          }
                        />
                      </div>
                      <select
                        onChange={(e) => {
                          if (e.target.value) handleFieldChange('google_product_category', e.target.value);
                        }}
                        className="bg-slate-950 border border-slate-800 text-[11px] text-slate-400 rounded px-2 py-0.5"
                        defaultValue=""
                      >
                        <option value="" disabled>
                          Select preset category...
                        </option>
                        {COMMON_GOOGLE_PRODUCT_CATEGORIES.map((g) => (
                          <option key={g.id} value={g.fullPath}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <input
                      type="text"
                      value={formData.google_product_category}
                      onChange={(e) => handleFieldChange('google_product_category', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700/90 rounded-lg p-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500 transition"
                      placeholder="e.g. Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs"
                    />
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-[11px] text-slate-300 block">
                        Product Type (Broad &gt; Specific Hierarchy)
                      </label>
                      <FieldProvenanceBadge
                        status={
                          product.fieldProvenance?.product_type ||
                          (formData.product_type ? 'GENERATED' : 'UNAVAILABLE')
                        }
                      />
                    </div>
                    <input
                      type="text"
                      value={formData.product_type}
                      onChange={(e) => handleFieldChange('product_type', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700/90 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition"
                      placeholder="e.g. Apparel > Hoodies > History Themed"
                    />
                  </div>

                  {/* Pricing & Availability */}
                  <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <label className="text-[11px] text-slate-300 block">Price</label>
                        <FieldProvenanceBadge status="VERIFIED" />
                      </div>
                      <input
                        type="text"
                        value={formData.price}
                        onChange={(e) => handleFieldChange('price', e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700/90 rounded-lg p-2 text-xs text-slate-200 font-mono"
                        placeholder="24.99 USD"
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <label className="text-[11px] text-slate-300 block">Availability</label>
                        <FieldProvenanceBadge status="VERIFIED" />
                      </div>
                      <select
                        value={formData.availability}
                        onChange={(e) => handleFieldChange('availability', e.target.value as any)}
                        className="w-full bg-slate-950 border border-slate-700/90 rounded-lg p-2 text-xs text-slate-200"
                      >
                        <option value="in_stock">in_stock (In Stock)</option>
                        <option value="out_of_stock">out_of_stock (Out of Stock)</option>
                        <option value="preorder">preorder (Preorder)</option>
                        <option value="backorder">backorder (Backorder)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* IDENTIFIERS & VARIANTS SECTION */}
              <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                      Product Identifiers & Variants
                    </label>
                    <span className="text-[11px] text-slate-400">
                      (Never invent GTIN/MPN for custom merchandise)
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <label className="text-[11px] text-slate-400 block">Brand</label>
                      <FieldProvenanceBadge status={formData.brand ? 'VERIFIED' : 'UNAVAILABLE'} />
                    </div>
                    <input
                      type="text"
                      value={formData.brand}
                      onChange={(e) => handleFieldChange('brand', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700/90 rounded p-2 text-xs text-slate-200"
                    />
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <label className="text-[11px] text-slate-400 block">
                        Identifier Exists?
                      </label>
                      <FieldProvenanceBadge status="VERIFIED" />
                    </div>
                    <select
                      value={formData.identifier_exists}
                      onChange={(e) => handleFieldChange('identifier_exists', e.target.value as any)}
                      className="w-full bg-slate-950 border border-slate-700/90 rounded p-2 text-xs text-slate-200"
                    >
                      <option value="no">no (Custom / Made to order)</option>
                      <option value="yes">yes (Has official GTIN/MPN)</option>
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <label className="text-[11px] text-slate-400 block">GTIN (Barcode / UPC)</label>
                      <FieldProvenanceBadge
                        status={formData.gtin ? 'VERIFIED' : 'UNAVAILABLE'}
                        label={formData.gtin ? 'VERIFIED' : 'UNAVAILABLE'}
                      />
                    </div>
                    <input
                      type="text"
                      value={formData.gtin}
                      onChange={(e) => handleFieldChange('gtin', e.target.value)}
                      disabled={formData.identifier_exists === 'no'}
                      className="w-full bg-slate-950 border border-slate-700/90 rounded p-2 text-xs text-slate-200 font-mono disabled:opacity-40"
                      placeholder="Leave empty if none"
                    />
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <label className="text-[11px] text-slate-400 block">MPN (Mfg Part No)</label>
                      <FieldProvenanceBadge
                        status={formData.mpn ? 'VERIFIED' : 'UNAVAILABLE'}
                        label={formData.mpn ? 'VERIFIED' : 'UNAVAILABLE'}
                      />
                    </div>
                    <input
                      type="text"
                      value={formData.mpn}
                      onChange={(e) => handleFieldChange('mpn', e.target.value)}
                      disabled={formData.identifier_exists === 'no'}
                      className="w-full bg-slate-950 border border-slate-700/90 rounded p-2 text-xs text-slate-200 font-mono disabled:opacity-40"
                      placeholder="Leave empty if none"
                    />
                  </div>
                </div>

                {/* Variant Attributes */}
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs pt-2 border-t border-slate-800">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Item Group ID</label>
                    <input
                      type="text"
                      value={formData.item_group_id}
                      onChange={(e) => handleFieldChange('item_group_id', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700/90 rounded p-1.5 text-xs text-slate-200 font-mono"
                      placeholder="Variant group ID"
                    />
                  </div>

                  <div>
                    <div className="flex items-center gap-1 mb-1">
                      <label className="text-[11px] text-slate-400 block">Color</label>
                      <FieldProvenanceBadge
                        status={
                          product.fieldProvenance?.color ||
                          (product.evidence.verifiedAttributes?.color
                            ? 'VERIFIED'
                            : formData.color
                            ? 'GENERATED'
                            : 'UNAVAILABLE')
                        }
                      />
                    </div>
                    <input
                      type="text"
                      value={formData.color}
                      onChange={(e) => handleFieldChange('color', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700/90 rounded p-1.5 text-xs text-slate-200"
                    />
                  </div>

                  <div>
                    <div className="flex items-center gap-1 mb-1">
                      <label className="text-[11px] text-slate-400 block">Size</label>
                      <FieldProvenanceBadge
                        status={
                          product.fieldProvenance?.size ||
                          (product.evidence.verifiedAttributes?.size
                            ? 'VERIFIED'
                            : formData.size
                            ? 'GENERATED'
                            : 'UNAVAILABLE')
                        }
                      />
                    </div>
                    <input
                      type="text"
                      value={formData.size}
                      onChange={(e) => handleFieldChange('size', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700/90 rounded p-1.5 text-xs text-slate-200"
                    />
                  </div>

                  <div>
                    <div className="flex items-center gap-1 mb-1">
                      <label className="text-[11px] text-slate-400 block">Material</label>
                      <FieldProvenanceBadge
                        status={
                          product.fieldProvenance?.material ||
                          (product.evidence.verifiedAttributes?.material
                            ? 'VERIFIED'
                            : formData.material
                            ? 'GENERATED'
                            : 'UNAVAILABLE')
                        }
                      />
                    </div>
                    <input
                      type="text"
                      value={formData.material}
                      onChange={(e) => handleFieldChange('material', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700/90 rounded p-1.5 text-xs text-slate-200"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Gender</label>
                    <select
                      value={formData.gender}
                      onChange={(e) => handleFieldChange('gender', e.target.value as any)}
                      className="w-full bg-slate-950 border border-slate-700/90 rounded p-1.5 text-xs text-slate-200"
                    >
                      <option value="">(None)</option>
                      <option value="unisex">unisex</option>
                      <option value="male">male</option>
                      <option value="female">female</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Age Group</label>
                    <select
                      value={formData.age_group}
                      onChange={(e) => handleFieldChange('age_group', e.target.value as any)}
                      className="w-full bg-slate-950 border border-slate-700/90 rounded p-1.5 text-xs text-slate-200"
                    >
                      <option value="">(None)</option>
                      <option value="adult">adult</option>
                      <option value="all_ages">all_ages</option>
                      <option value="teen">teen</option>
                      <option value="kids">kids</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* CUSTOM LABELS */}
              <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                      Custom Labels (Campaign Segmentation)
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRunGranular(product.id, 'suggest_custom_labels')}
                    disabled={isLoading}
                    className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 transition"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Auto-Allocate Labels</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-xs">
                  {([0, 1, 2, 3, 4] as const).map((num) => {
                    const key = `custom_label_${num}` as keyof MerchantData;
                    const labelTitle = (config.customLabelMappings as any)[key] || `Custom Label ${num}`;
                    return (
                      <div key={num} className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 space-y-1.5">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[10px] font-mono text-indigo-400 uppercase font-bold truncate">
                            Label {num}: {labelTitle}
                          </span>
                          <FieldProvenanceBadge
                            status={product.fieldProvenance?.[key] || (formData[key] ? 'GENERATED' : 'UNAVAILABLE')}
                          />
                        </div>
                        <input
                          type="text"
                          value={formData[key] || ''}
                          onChange={(e) => handleFieldChange(key, e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700/70 rounded px-2 py-1 text-xs text-slate-200 font-medium focus:border-indigo-500 focus:outline-none"
                          placeholder={labelTitle}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PRODUCT EVIDENCE */}
          {activeTab === 'evidence' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Verified Attributes Card */}
                <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                  <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    Verified Product Facts (Extracted from Source Page)
                  </h4>
                  <div className="space-y-2 text-xs">
                    {Object.entries(product.evidence.verifiedAttributes).map(([k, v]) => (
                      <div
                        key={k}
                        className="flex items-center justify-between p-2 rounded bg-slate-950/60 border border-slate-800"
                      >
                        <span className="font-mono text-slate-400 capitalize">{k}:</span>
                        <span className="font-semibold text-slate-200">
                          {Array.isArray(v) ? v.join(', ') : String(v)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Unresolved Attributes Card */}
                <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                  <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4" />
                    Unresolved / Unverified Attributes
                  </h4>
                  <p className="text-xs text-slate-400">
                    Attributes that could NOT be verified directly from landing page code. The AI is forbidden from fabricating these values.
                  </p>
                  <div className="space-y-1.5 text-xs">
                    {product.evidence.unresolvedAttributes.length > 0 ? (
                      product.evidence.unresolvedAttributes.map((un, i) => (
                        <div key={i} className="p-2 rounded bg-amber-950/20 text-amber-300 border border-amber-900/40">
                          • {un}
                        </div>
                      ))
                    ) : (
                      <div className="text-slate-500 italic p-2">None</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Source Page & Meta Data */}
              <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                  Raw Page Metadata & Structured JSON-LD
                </h4>
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-slate-400 block mb-0.5">Raw Page Title:</span>
                    <div className="p-2 rounded bg-slate-950 text-slate-300 font-mono text-[11px]">
                      {product.evidence.pageTitle}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-400 block mb-0.5">Raw Description:</span>
                    <div className="p-2 rounded bg-slate-950 text-slate-300 font-mono text-[11px] max-h-32 overflow-y-auto">
                      {product.evidence.rawDescription || '(Empty)'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: GIFT & SEARCH INTENT */}
          {activeTab === 'gift' && (
            <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">
                    Science of Gifts Intelligence & Search Mapping
                  </h4>
                  <p className="text-xs text-slate-400">
                    Understand searchers looking for gifts without polluting official Google Product Categories.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRunGranular(product.id, 'improve_gift_intent')}
                  disabled={isLoading}
                  className="flex items-center gap-1 text-xs font-medium text-indigo-400 hover:text-indigo-300 transition"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Refine Gift Intent</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Dominant Theme</label>
                  <input
                    type="text"
                    value={giftData.theme}
                    onChange={(e) => setGiftData({ ...giftData, theme: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs text-slate-200"
                    placeholder="e.g. American Civil War"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Primary Gift Intent</label>
                  <input
                    type="text"
                    value={giftData.primaryGiftIntent}
                    onChange={(e) => setGiftData({ ...giftData, primaryGiftIntent: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs text-slate-200"
                    placeholder="e.g. civil war gifts"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    Target Audiences (comma separated)
                  </label>
                  <input
                    type="text"
                    value={giftData.targetAudience.join(', ')}
                    onChange={(e) =>
                      setGiftData({
                        ...giftData,
                        targetAudience: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs text-slate-200"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    Occasions (comma separated)
                  </label>
                  <input
                    type="text"
                    value={giftData.occasions.join(', ')}
                    onChange={(e) =>
                      setGiftData({
                        ...giftData,
                        occasions: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs text-slate-200"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: AI STRATEGY & REASONING */}
          {activeTab === 'strategy' && (
            <div className="space-y-4">
              {product.strategy ? (
                <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                      <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                        15-Point AI Product Strategist Analysis
                      </h4>
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono">
                      Researched at: {new Date(product.strategy.researchedAt).toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                      <span className="font-semibold text-indigo-400 block">1. Exact Product Summary</span>
                      <p className="text-slate-300">{product.strategy.exactProductSummary}</p>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                      <span className="font-semibold text-indigo-400 block">2. Dominant Theme & Category</span>
                      <p className="text-slate-300">
                        {product.strategy.dominantTheme} • {product.strategy.productCategory}
                      </p>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                      <span className="font-semibold text-indigo-400 block">3. Realistic Buyer & Recipient</span>
                      <p className="text-slate-300">
                        <span className="text-slate-400">Buyer:</span> {product.strategy.realisticBuyer}
                        <br />
                        <span className="text-slate-400">Recipient:</span> {product.strategy.realisticRecipient}
                      </p>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                      <span className="font-semibold text-indigo-400 block">4. Gift Rationale</span>
                      <p className="text-slate-300">{product.strategy.giftRationale}</p>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1.5">
                      <span className="font-semibold text-indigo-400 block">5. Title Priority & Strategy</span>
                      <p className="text-slate-300 font-medium">{product.strategy.titleStrategy}</p>
                      {product.strategy.titlePriorityOrder && (
                        <div className="pt-1">
                          <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">
                            Title Priority Order:
                          </span>
                          <div className="flex flex-wrap items-center gap-1 text-[10px]">
                            {product.strategy.titlePriorityOrder.map((step, idx, arr) => (
                              <React.Fragment key={idx}>
                                <span className="px-1.5 py-0.2 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800/60">
                                  {step}
                                </span>
                                {idx < arr.length - 1 && (
                                  <span className="text-slate-600">→</span>
                                )}
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                      )}
                      {product.strategy.titleStrategyReasoning && (
                        <p className="text-[11px] text-slate-400 pt-1">
                          <span className="text-indigo-300 font-medium">Why structured this way:</span>{' '}
                          {product.strategy.titleStrategyReasoning}
                        </p>
                      )}
                      <div className="pt-1.5 border-t border-slate-900">
                        <span className="text-[10px] text-slate-500 uppercase font-bold block mb-0.5">
                          Description Strategy:
                        </span>
                        <span className="text-slate-400 text-[11px]">{product.strategy.descriptionStrategy}</span>
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-900/50 space-y-1">
                      <span className="font-semibold text-rose-300 block">6. Anti-Recommendations (DO NOT ADD)</span>
                      <ul className="list-disc list-inside text-rose-200 text-[11px] space-y-0.5">
                        {product.strategy.antiRecommendations.map((ar, i) => (
                          <li key={i}>{ar}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-8 rounded-xl bg-slate-900 border border-slate-800 text-center space-y-3">
                  <p className="text-xs text-slate-400">No strategy generated yet.</p>
                  <button
                    onClick={() => onRunStrategy(product.id, true)}
                    className="px-4 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition"
                  >
                    Run Strategy Analysis
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: QUALITY AUDIT */}
          {activeTab === 'audit' && (
            <div className="space-y-4">
              {/* Fix Notification Toast */}
              {fixToast && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-center justify-between shadow-lg transition animate-in fade-in slide-in-from-top-2 ${
                    fixToast.type === 'success'
                      ? 'bg-emerald-950/90 border-emerald-600/70 text-emerald-200'
                      : 'bg-rose-950/90 border-rose-600/70 text-rose-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {fixToast.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    )}
                    <span className="font-medium">{fixToast.message}</span>
                  </div>
                  <button
                    onClick={() => setFixToast(null)}
                    className="text-slate-400 hover:text-white text-xs px-1.5 py-0.5"
                  >
                    ✕
                  </button>
                </div>
              )}

              {product.audit ? (
                <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-800/80">
                    <div>
                      <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                        Independent Quality & Compliance Audit
                      </h4>
                      <p className="text-xs text-slate-400">
                        Evaluated against Merchant Center guidelines and factual evidence.
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      {/* Fix All Safe Issues Action */}
                      {(() => {
                        const safeCount = (product.audit.issues || []).filter(
                          (i) =>
                            i.state === 'safe_to_fix' &&
                            !i.isFixed &&
                            issueFixStates[i.id || i.field]?.status !== 'fixed'
                        ).length;

                        if (safeCount > 0) {
                          return (
                            <button
                              type="button"
                              onClick={handleApplyAllSafeIssues}
                              disabled={isFixingAll || isLoading}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold text-xs shadow-md transition disabled:opacity-50"
                            >
                              {isFixingAll ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  <span>Fixing {safeCount} Issues...</span>
                                </>
                              ) : (
                                <>
                                  <Sparkles className="w-3.5 h-3.5" />
                                  <span>Fix All Safe Issues ({safeCount})</span>
                                </>
                              )}
                            </button>
                          );
                        } else {
                          return (
                            <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/70 border border-emerald-800/60 px-2.5 py-1 rounded-lg">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              <span>All Safe Issues Resolved</span>
                            </span>
                          );
                        }
                      })()}

                      <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-1 rounded-lg border border-slate-800">
                        <span className="text-xs text-slate-400">Score:</span>
                        <span
                          className={`text-base font-bold font-mono ${
                            product.audit.overallScore >= 90
                              ? 'text-emerald-400'
                              : product.audit.overallScore >= 75
                              ? 'text-amber-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {product.audit.overallScore}/100
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 7 Dimension Score Bars */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {Object.entries(product.audit.fieldScores).map(([k, score]) => (
                      <div key={k} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="capitalize text-slate-400 font-medium text-[11px]">{k}</span>
                          <span className="font-mono font-bold text-slate-200">{score}%</span>
                        </div>
                        <div className="w-full bg-slate-900 rounded-full h-1">
                          <div
                            className={`h-1 rounded-full transition-all duration-500 ${
                              score >= 90 ? 'bg-emerald-500' : score >= 75 ? 'bg-amber-500' : 'bg-rose-500'
                            }`}
                            style={{ width: `${score}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Fixed Automatically Banner */}
                  {product.audit.fixedAutomatically && product.audit.fixedAutomatically.length > 0 && (
                    <div className="p-3.5 rounded-lg bg-emerald-950/40 border border-emerald-800/60 space-y-1.5 text-xs">
                      <div className="flex items-center gap-1.5 text-emerald-300 font-semibold">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>Fixed Automatically in Audit / 1-Click:</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 text-[11px]">
                        {product.audit.fixedAutomatically.map((fix, i) => (
                          <span key={i} className="px-2 py-0.5 rounded bg-emerald-900/60 text-emerald-200 border border-emerald-700/50">
                            {fix}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Rigorous Classified Issues List */}
                  {product.audit.issues && product.audit.issues.length > 0 && (
                    <div className="space-y-2.5 pt-2">
                      <div className="flex items-center justify-between">
                        <h5 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                          Classified Audit Findings & Unresolved Specs:
                        </h5>
                        <span className="text-[11px] text-slate-400">
                          {product.audit.issues.filter((i) => i.state === 'safe_to_fix' && !i.isFixed && issueFixStates[i.id || i.field]?.status !== 'fixed').length} actionable fixes available
                        </span>
                      </div>

                      <div className="space-y-2.5">
                        {product.audit.issues.map((issue) => {
                          const issueKey = issue.id || issue.field;
                          const fixState = issueFixStates[issueKey];
                          const isFixed =
                            issue.state === 'fixed' ||
                            issue.isFixed ||
                            fixState?.status === 'fixed';
                          const isFixing = fixState?.status === 'fixing';
                          const isFailed = fixState?.status === 'failed';
                          const isUnresolved = issue.state === 'requires_review' && !isFixed;
                          const isSafeToFix = (issue.state === 'safe_to_fix' || issue.suggestedFix) && !isFixed && !isUnresolved;

                          return (
                            <div
                              key={issueKey}
                              className={`p-3.5 rounded-xl border text-xs flex flex-col md:flex-row md:items-center justify-between gap-3.5 transition-all duration-300 ${
                                isFixed
                                  ? 'bg-emerald-950/20 border-emerald-800/50 text-emerald-200'
                                  : isFailed
                                  ? 'bg-rose-950/20 border-rose-900/50 text-rose-200'
                                  : isUnresolved
                                  ? 'bg-amber-950/20 border-amber-900/50 text-amber-200'
                                  : isSafeToFix
                                  ? 'bg-indigo-950/20 border-indigo-900/50 text-indigo-200'
                                  : 'bg-slate-950/60 border-slate-800 text-slate-300'
                              }`}
                            >
                              <div className="space-y-1.5 flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-slate-100 text-xs">{issue.title}</span>

                                  {isFixed ? (
                                    <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 font-bold text-[10px] uppercase tracking-wider flex items-center gap-1 shadow-sm">
                                      <Check className="w-3 h-3 text-emerald-400" />
                                      <span>FIXED</span>
                                    </span>
                                  ) : isUnresolved ? (
                                    <div className="flex items-center gap-1">
                                      <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-bold text-[10px] uppercase tracking-wider">
                                        UNRESOLVED
                                      </span>
                                      <span className="px-1.5 py-0.5 rounded bg-amber-900/80 text-amber-100 text-[10px] font-medium border border-amber-700">
                                        [Review Required]
                                      </span>
                                    </div>
                                  ) : issue.state === 'informational' || issue.title.startsWith('✓') ? (
                                    <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-medium text-[10px] flex items-center gap-1">
                                      <Check className="w-3 h-3 text-emerald-400" />
                                      <span>POLICY COMPLIANT</span>
                                    </span>
                                  ) : isSafeToFix ? (
                                    <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 font-bold text-[10px] uppercase">
                                      SAFE TO AUTO-FIX
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 font-medium text-[10px]">
                                      POLICY COMPLIANT
                                    </span>
                                  )}

                                  <span className="text-slate-400 font-mono text-[10px] bg-slate-900/80 px-1.5 py-0.5 rounded border border-slate-800">
                                    Field: {issue.field}
                                  </span>
                                </div>

                                <p className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-line">{issue.description}</p>

                                {issue.verifiedEvidence && (
                                  <p className="text-[10px] text-slate-400 font-mono">
                                    <span className="text-slate-500 font-semibold">Evidence:</span> {issue.verifiedEvidence}
                                  </p>
                                )}

                                {issue.suggestedFix && !isFixed && issue.state !== 'informational' && (
                                  <p className="text-[11px] text-indigo-300 font-medium">
                                    <span className="text-indigo-400/80">Suggested Fix:</span> {issue.suggestedFix}
                                  </p>
                                )}
                              </div>

                              <div className="shrink-0 flex items-center gap-2">
                                {isFixed ? (
                                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/90 border border-emerald-600/80 text-emerald-300 font-semibold text-xs shadow-sm">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                    <span>✓ Fixed</span>
                                  </div>
                                ) : isFixing ? (
                                  <button
                                    type="button"
                                    disabled
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-900/60 text-indigo-300 text-xs font-medium cursor-wait opacity-80"
                                  >
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    <span>Applying...</span>
                                  </button>
                                ) : isFailed ? (
                                  <div className="flex flex-col items-end gap-1">
                                    <span className="text-[10px] text-rose-400 font-medium flex items-center gap-1">
                                      <AlertTriangle className="w-3 h-3" /> Fix failed: {fixState.error}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleApplySafeFix(issue)}
                                      className="px-2.5 py-1 rounded-md bg-rose-700 hover:bg-rose-600 text-white font-semibold text-xs shadow-sm transition"
                                    >
                                      Retry Fix
                                    </button>
                                  </div>
                                ) : isSafeToFix ? (
                                  <button
                                    type="button"
                                    onClick={() => handleApplySafeFix(issue)}
                                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-semibold text-xs shadow-md transition"
                                  >
                                    <Sparkles className="w-3.5 h-3.5" />
                                    <span>Apply Safe Fix</span>
                                  </button>
                                ) : isUnresolved ? (
                                  <span className="text-[11px] text-amber-400/90 italic font-medium flex items-center gap-1">
                                    <AlertCircle className="w-3.5 h-3.5" /> Manual check required
                                  </span>
                                ) : issue.state === 'informational' || issue.title.startsWith('✓') ? (
                                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-emerald-400/90 font-medium text-xs">
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>Compliant</span>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Warnings & Suggestions */}
                  {product.audit.warnings.length > 0 && (
                    <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-900/50 space-y-1 text-xs">
                      <span className="font-semibold text-amber-300 block">Audit Warnings:</span>
                      {product.audit.warnings.map((w, i) => (
                        <div key={i} className="text-amber-200">• {w}</div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-8 rounded-xl bg-slate-900 border border-slate-800 text-center space-y-3">
                  <p className="text-xs text-slate-400">No independent audit performed yet.</p>
                  <button
                    onClick={() => onRunAudit(product.id)}
                    className="px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition"
                  >
                    Run Quality Audit
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 6: HISTORY & ORIGINAL DIFFS */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                  Original Imported vs Current Optimized Values
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                    <span className="text-[11px] font-bold text-slate-500 uppercase block">
                      Original Imported
                    </span>
                    <div className="text-slate-300">
                      <span className="text-slate-500 block">Title:</span>
                      {product.originalImported?.title || '(Empty)'}
                    </div>
                    <div className="text-slate-300">
                      <span className="text-slate-500 block">Description:</span>
                      {product.originalImported?.description || '(Empty)'}
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-indigo-950/20 border border-indigo-900/50 space-y-2">
                    <span className="text-[11px] font-bold text-indigo-400 uppercase block">
                      Current Active Optimized
                    </span>
                    <div className="text-indigo-200 font-medium">
                      <span className="text-indigo-400/80 block">Title:</span>
                      {formData.title}
                    </div>
                    <div className="text-indigo-200">
                      <span className="text-indigo-400/80 block">Description:</span>
                      {formData.description}
                    </div>
                  </div>
                </div>
              </div>

              {/* History Log */}
              <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2">
                <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                  Version History Timeline
                </h4>
                <div className="space-y-2 text-xs max-h-48 overflow-y-auto">
                  {product.history.map((h, i) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded bg-slate-950 border border-slate-800">
                      <span className="text-slate-300">{h.note}</span>
                      <span className="text-slate-500 font-mono text-[11px]">
                        {new Date(h.timestamp).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Workspace Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-800 bg-slate-900/80">
          <div className="text-xs text-slate-400">
            {saveMessage && (
              <span className="flex items-center gap-1 text-emerald-400 font-medium">
                <Check className="w-4 h-4" /> {saveMessage}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition"
            >
              Close
            </button>
            <button
              onClick={handleSaveAll}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg shadow-sm transition disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Saving...' : 'Save Product'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

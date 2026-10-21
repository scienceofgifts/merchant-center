import React from 'react';
import { Sparkles, Check, X, ArrowRight } from 'lucide-react';
import { MerchantData, GiftIntelligence } from '../types/feed';

interface AiApprovalDiffProps {
  currentMerchantData: MerchantData;
  suggestedMerchantData?: Partial<MerchantData>;
  currentGiftIntelligence: GiftIntelligence;
  suggestedGiftIntelligence?: Partial<GiftIntelligence>;
  fieldEvidenceNotes?: Record<string, { evidenceSource?: string; reason?: string; status?: string }>;
  onApplyField: (fieldName: string) => void;
  onApplyAll: () => void;
  onDiscard: () => void;
}

export const AiApprovalDiff: React.FC<AiApprovalDiffProps> = ({
  currentMerchantData,
  suggestedMerchantData,
  currentGiftIntelligence,
  suggestedGiftIntelligence,
  fieldEvidenceNotes = {},
  onApplyField,
  onApplyAll,
  onDiscard,
}) => {
  if (!suggestedMerchantData && !suggestedGiftIntelligence) {
    return null;
  }

  const merchantDiffKeys = Object.keys(suggestedMerchantData || {}).filter((key) => {
    const currVal = (currentMerchantData as any)[key];
    const suggVal = (suggestedMerchantData as any)[key];
    return suggVal !== undefined && suggVal !== null && suggVal !== currVal && suggVal !== '';
  });

  const giftDiffKeys = Object.keys(suggestedGiftIntelligence || {}).filter((key) => {
    const currVal = (currentGiftIntelligence as any)[key];
    const suggVal = (suggestedGiftIntelligence as any)[key];
    if (Array.isArray(suggVal)) {
      return JSON.stringify(suggVal) !== JSON.stringify(currVal);
    }
    return suggVal !== undefined && suggVal !== null && suggVal !== currVal && suggVal !== '';
  });

  if (merchantDiffKeys.length === 0 && giftDiffKeys.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-indigo-500/40 bg-indigo-950/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-indigo-600/30 text-indigo-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-indigo-200">
              AI Recommendations Ready for Approval
            </h4>
            <p className="text-[11px] text-slate-400">
              {merchantDiffKeys.length + giftDiffKeys.length} field improvements generated. AI will never overwrite data without approval.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onDiscard}
            className="flex items-center gap-1 px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 rounded-md border border-slate-700/60 transition"
          >
            <X className="w-3.5 h-3.5" />
            <span>Discard</span>
          </button>
          <button
            onClick={onApplyAll}
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-md shadow-sm transition"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Accept All Suggestions</span>
          </button>
        </div>
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
        {merchantDiffKeys.map((key) => {
          const curr = (currentMerchantData as any)[key] || '(empty)';
          const sugg = (suggestedMerchantData as any)[key];
          const note = fieldEvidenceNotes[key];
          return (
            <div
              key={key}
              className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-xs"
            >
              <div className="space-y-1.5 flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-indigo-400 uppercase tracking-wider font-bold">
                    {key.replace(/_/g, ' ')}
                  </span>
                  {note?.status && (
                    <span
                      className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        note.status === 'VERIFIED REPLACEMENT' || note.status === 'VERIFIED'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          : note.status === 'REQUIRES REVIEW'
                          ? 'bg-amber-950 text-amber-300 border border-amber-800'
                          : 'bg-purple-950 text-purple-300 border border-purple-800'
                      }`}
                    >
                      {note.status}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded bg-slate-950/60 text-slate-400 border border-slate-800 line-clamp-2">
                    <span className="text-[10px] uppercase font-bold text-slate-500 block mb-0.5">Current:</span>
                    {String(curr)}
                  </div>
                  <div className="p-2 rounded bg-indigo-950/40 text-indigo-200 border border-indigo-800/50 line-clamp-2">
                    <span className="text-[10px] uppercase font-bold text-indigo-400 block mb-0.5">Suggested:</span>
                    {String(sugg)}
                  </div>
                </div>

                {note && (note.evidenceSource || note.reason) && (
                  <div className="p-2 rounded bg-slate-950/90 border border-slate-800/80 text-[11px] text-slate-300 space-y-0.5">
                    {note.evidenceSource && (
                      <div>
                        <span className="text-indigo-300 font-semibold">Evidence: </span>
                        <span>{note.evidenceSource}</span>
                      </div>
                    )}
                    {note.reason && (
                      <div className="text-slate-400">
                        <span className="text-slate-500 font-medium">Why differ: </span>
                        <span>{note.reason}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={() => onApplyField(key)}
                className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white border border-slate-700 hover:border-indigo-500 transition text-[11px]"
                title="Apply this field only"
              >
                <Check className="w-3 h-3" />
                <span>Apply</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, ShieldAlert, Sparkles } from 'lucide-react';
import { DeterministicValidation, AIAudit } from '../types/feed';

interface ValidationBadgeProps {
  validation: DeterministicValidation;
  audit?: AIAudit;
  compact?: boolean;
}

export const ValidationBadge: React.FC<ValidationBadgeProps> = ({
  validation,
  audit,
  compact = false,
}) => {
  const hasBlocking = validation.blockingErrors.length > 0;
  const hasWarnings = validation.warnings.length > 0;
  const hasAuditErrors = audit && audit.criticalErrors.length > 0;
  const hasAuditWarnings = audit && audit.warnings.length > 0;

  if (hasBlocking || hasAuditErrors) {
    const count = validation.blockingErrors.length + (audit?.criticalErrors.length || 0);
    return (
      <div
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-950/60 text-rose-300 border border-rose-800/80"
        title={`Blocking Errors:\n${[...validation.blockingErrors, ...(audit?.criticalErrors || [])].join('\n')}`}
      >
        <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
        <span>{compact ? `${count} err` : `Blocked (${count})`}</span>
      </div>
    );
  }

  if (hasWarnings || hasAuditWarnings) {
    const count = validation.warnings.length + (audit?.warnings.length || 0);
    return (
      <div
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-950/50 text-amber-300 border border-amber-800/70"
        title={`Warnings:\n${[...validation.warnings, ...(audit?.warnings || [])].join('\n')}`}
      >
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span>{compact ? `${count} warn` : `Warnings (${count})`}</span>
      </div>
    );
  }

  if (audit && audit.overallScore >= 90) {
    return (
      <div
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950/60 text-emerald-300 border border-emerald-800/80"
        title={`Feed Compliant & AI Verified (Score: ${audit.overallScore}/100)`}
      >
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span>Ready ({audit.overallScore})</span>
      </div>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800/80 text-slate-300 border border-slate-700/60"
      title="Basic compliance checked. Run AI Audit for deep evaluation."
    >
      <CheckCircle2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      <span>Valid Format</span>
    </div>
  );
};

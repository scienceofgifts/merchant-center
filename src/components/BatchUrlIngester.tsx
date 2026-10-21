import React, { useState } from 'react';
import { X, Plus, AlertCircle, CheckCircle2, Loader2, Sparkles, ExternalLink } from 'lucide-react';
import { ProductItem } from '../types/feed';

interface BatchUrlIngesterProps {
  isOpen: boolean;
  onClose: () => void;
  onBatchIngested: (products: ProductItem[]) => void;
}

export const BatchUrlIngester: React.FC<BatchUrlIngesterProps> = ({
  isOpen,
  onClose,
  onBatchIngested,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; currentUrl: string }>({
    current: 0,
    total: 0,
    currentUrl: '',
  });
  const [results, setResults] = useState<
    Array<{ url: string; success: boolean; product?: ProductItem; error?: string }>
  >([]);

  if (!isOpen) return null;

  const sampleUrls = [
    'https://scienceofgifts.fourthwall.com/products/civil-war-hoodie',
    'https://scienceofgifts.fourthwall.com/products/gettysburg-1863-coffee-mug',
    'https://scienceofgifts.fourthwall.com/products/screenwriter-clapperboard-notebook',
    'https://scienceofgifts.fourthwall.com/products/spitfire-mk-ix-blueprint-poster',
    'https://scienceofgifts.fourthwall.com/products/marcus-aurelius-stoic-philosophy-shirt',
  ];

  const handleStartIngest = async () => {
    const urls = urlInput
      .split('\n')
      .map((u) => u.trim())
      .filter((u) => u.length > 5 && (u.startsWith('http://') || u.startsWith('https://')));

    if (urls.length === 0) return;

    setIsProcessing(true);
    setProgress({ current: 0, total: urls.length, currentUrl: urls[0] });
    setResults([]);

    try {
      const response = await fetch('/api/products/batch-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      });

      const data = await response.json();
      if (data.success) {
        setResults(data.results);
        const successfulProducts = data.results
          .filter((r: any) => r.success && r.product)
          .map((r: any) => r.product);
        if (successfulProducts.length > 0) {
          onBatchIngested(successfulProducts);
        }
      }
    } catch (err: any) {
      console.error('Batch ingest error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLoadSamples = () => {
    setUrlInput(sampleUrls.join('\n'));
  };

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.filter((r) => !r.success).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center">
              <Plus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                Batch URL Product Ingestion
              </h3>
              <p className="text-xs text-slate-400">
                Paste product URLs from Fourthwall or any store to extract evidence & structured data
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-300">
                Product URLs (One per line)
              </label>
              <button
                type="button"
                onClick={handleLoadSamples}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 transition"
              >
                Insert sample Science of Gifts URLs
              </button>
            </div>
            <textarea
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              disabled={isProcessing}
              placeholder="https://scienceofgifts.fourthwall.com/products/civil-war-hoodie&#10;https://scienceofgifts.fourthwall.com/products/gettysburg-1863-coffee-mug"
              rows={6}
              className="w-full rounded-lg bg-slate-950 border border-slate-700/80 p-3 text-xs text-slate-200 placeholder-slate-500 font-mono focus:outline-none focus:border-indigo-500 transition resize-y"
            />
          </div>

          {/* Processing Progress Bar */}
          {isProcessing && (
            <div className="p-3.5 rounded-lg bg-slate-800/80 border border-slate-700 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                  Extracting HTML, JSON-LD, prices, and variant evidence...
                </span>
                <span className="font-mono text-indigo-400">
                  {progress.current} / {progress.total}
                </span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
                  style={{
                    width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 50}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Results Summary */}
          {results.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-300">
                  Ingestion Results: {results.length} processed
                </span>
                <span className="text-emerald-400 font-medium">
                  ✓ {successCount} added {failureCount > 0 && `• ✗ ${failureCount} failed`}
                </span>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {results.map((res, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between p-2 rounded-lg text-xs border ${
                      res.success
                        ? 'bg-emerald-950/20 border-emerald-900/50 text-emerald-200'
                        : 'bg-rose-950/20 border-rose-900/50 text-rose-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate flex-1 mr-2">
                      {res.success ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      )}
                      <span className="truncate font-mono text-[11px]">{res.url}</span>
                    </div>
                    {res.product && (
                      <span className="text-[11px] font-medium text-slate-300 shrink-0">
                        {res.product.merchantData.title.slice(0, 30)}...
                      </span>
                    )}
                    {res.error && (
                      <span className="text-[11px] text-rose-400 shrink-0 font-mono">
                        {res.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-3.5 border-t border-slate-800 bg-slate-900/50">
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition"
          >
            {results.length > 0 ? 'Done' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleStartIngest}
            disabled={isProcessing || !urlInput.trim()}
            className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow-sm transition disabled:opacity-50"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Extracting...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Extract & Add Products</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

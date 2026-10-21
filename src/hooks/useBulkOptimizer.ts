import { useState, useRef, useCallback } from 'react';
import { ProductItem } from '../types/feed';
import { BulkOptimizationItem, BulkQueueSummary } from '../types/bulk';

interface UseBulkOptimizerOptions {
  onProductUpdated: (updatedProduct: ProductItem) => void;
}

export function useBulkOptimizer({ onProductUpdated }: UseBulkOptimizerOptions) {
  const [queueItems, setQueueItems] = useState<BulkOptimizationItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isCancelled, setIsCancelled] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [summary, setSummary] = useState<BulkQueueSummary | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Refs for synchronous loop controls without closure lag
  const isRunningRef = useRef(false);
  const isPausedRef = useRef(false);
  const isCancelledRef = useRef(false);
  const queueItemsRef = useRef<BulkOptimizationItem[]>([]);
  const onProductUpdatedRef = useRef(onProductUpdated);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const activeProductIdRef = useRef<string | null>(null);

  onProductUpdatedRef.current = onProductUpdated;
  queueItemsRef.current = queueItems;

  const updateQueueItem = (id: string, updates: Partial<BulkOptimizationItem>) => {
    setQueueItems((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, ...updates } : item));
      queueItemsRef.current = next;
      return next;
    });
  };

  const calculateSummary = useCallback((items: BulkOptimizationItem[]): BulkQueueSummary => {
    const totalSelected = items.length;
    const completed = items.filter((i) => i.status === 'COMPLETED');
    const failed = items.filter((i) => i.status === 'FAILED');
    const skipped = items.filter((i) => i.status === 'SKIPPED');
    const cancelled = items.filter((i) => i.status === 'CANCELLED');

    let totalBefore = 0;
    let totalAfter = 0;
    let scoreCount = 0;

    const fieldCounts = {
      title: 0,
      description: 0,
      productType: 0,
      googleProductCategory: 0,
      customLabels: 0,
      giftIntelligence: 0,
    };

    completed.forEach((i) => {
      if (i.beforeScore !== undefined && i.afterScore !== undefined) {
        totalBefore += i.beforeScore;
        totalAfter += i.afterScore;
        scoreCount++;
      }

      (i.appliedFields || []).forEach((field) => {
        const lower = field.toLowerCase();
        if (lower.includes('title')) fieldCounts.title++;
        if (lower.includes('description')) fieldCounts.description++;
        if (lower.includes('product type')) fieldCounts.productType++;
        if (lower.includes('google product category') || lower.includes('category')) fieldCounts.googleProductCategory++;
        if (lower.includes('custom label')) fieldCounts.customLabels++;
        if (lower.includes('gift') || lower.includes('search intent')) fieldCounts.giftIntelligence++;
      });
    });

    return {
      totalSelected,
      completedCount: completed.length,
      failedCount: failed.length,
      skippedCount: skipped.length,
      cancelledCount: cancelled.length,
      avgBeforeScore: scoreCount > 0 ? Math.round(totalBefore / scoreCount) : 0,
      avgAfterScore: scoreCount > 0 ? Math.round(totalAfter / scoreCount) : 0,
      fieldCounts,
    };
  }, []);

  // Process a single product with abort signal, retry logic, and cancellation checks
  const processProduct = async (
    item: BulkOptimizationItem,
    signal?: AbortSignal,
    maxRetries = 2
  ): Promise<{
    success: boolean;
    product?: ProductItem;
    beforeScore?: number;
    afterScore?: number;
    appliedFields?: string[];
    error?: string;
    cancelled?: boolean;
  }> => {
    let attempts = 0;
    let lastError = '';

    while (attempts <= maxRetries) {
      if (isCancelledRef.current || signal?.aborted) {
        return { success: false, cancelled: true };
      }

      try {
        const res = await fetch(`/api/ai/optimize-and-apply/${item.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
        });

        if (isCancelledRef.current || signal?.aborted) {
          return { success: false, cancelled: true };
        }

        const data = await res.json();

        if (isCancelledRef.current || signal?.aborted) {
          return { success: false, cancelled: true };
        }

        if (res.ok && data.success && data.product) {
          // Strictly verify returned product ID matches expected product
          if (data.product.id !== item.id) {
            return { success: false, error: 'Product ID mismatch in response' };
          }
          return {
            success: true,
            product: data.product,
            beforeScore: data.beforeScore,
            afterScore: data.afterScore,
            appliedFields: data.appliedFields || [],
          };
        } else {
          lastError = data.error || `Server responded with status ${res.status}`;
          const isRetryable = [429, 500, 502, 503, 504].includes(res.status);
          if (!isRetryable || attempts >= maxRetries || isCancelledRef.current || signal?.aborted) {
            return { success: false, error: lastError };
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError' || isCancelledRef.current || signal?.aborted) {
          return { success: false, cancelled: true };
        }
        lastError = err.message || 'Network error / request failed';
        if (attempts >= maxRetries || isCancelledRef.current || signal?.aborted) {
          return { success: false, error: lastError };
        }
      }

      attempts++;
      if (isCancelledRef.current || signal?.aborted) {
        return { success: false, cancelled: true };
      }

      updateQueueItem(item.id, { retryCount: attempts });

      // Cancellable exponential backoff sleep
      const waitTimeMs = 1000 * attempts;
      const sleepStart = Date.now();
      while (Date.now() - sleepStart < waitTimeMs) {
        if (isCancelledRef.current || signal?.aborted) {
          return { success: false, cancelled: true };
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    return { success: false, error: lastError || 'Max retries exceeded' };
  };

  // Main Sequential Loop (Concurrency = 1)
  const runSequentialQueue = async (initialItems: BulkOptimizationItem[]) => {
    // Prevent duplicate queue execution
    if (isRunningRef.current) {
      console.warn('Queue is already running, skipping duplicate start request');
      return;
    }

    isRunningRef.current = true;
    setIsRunning(true);
    setIsPaused(false);
    setIsCancelled(false);
    isPausedRef.current = false;
    isCancelledRef.current = false;

    try {
      for (let i = 0; i < initialItems.length; i++) {
        // Check cancellation before processing next item
        if (isCancelledRef.current) {
          break;
        }

        // Check pause state - resolves cleanly every 200ms
        while (isPausedRef.current && !isCancelledRef.current) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }

        if (isCancelledRef.current) {
          break;
        }

        setCurrentIndex(i);

        const currentItem = queueItemsRef.current[i] || initialItems[i];
        // Do NOT rerun already completed, skipped, or failed items unless queued
        if (!currentItem || currentItem.status !== 'QUEUED') {
          continue;
        }

        // Mark current item as OPTIMIZING
        activeProductIdRef.current = currentItem.id;
        updateQueueItem(currentItem.id, { status: 'OPTIMIZING' });

        const abortController = new AbortController();
        activeAbortControllerRef.current = abortController;

        const result = await processProduct(currentItem, abortController.signal);

        activeAbortControllerRef.current = null;

        // If cancelled while the operation was running, do NOT apply late response
        if (isCancelledRef.current || result.cancelled) {
          updateQueueItem(currentItem.id, { status: 'CANCELLED' });
          break;
        }

        if (result.success && result.product && result.product.id === currentItem.id) {
          // Verify we were not cancelled before applying product state
          if (!isCancelledRef.current) {
            onProductUpdatedRef.current(result.product);

            updateQueueItem(currentItem.id, {
              status: 'COMPLETED',
              beforeScore: result.beforeScore,
              afterScore: result.afterScore,
              appliedFields: result.appliedFields,
            });
          } else {
            updateQueueItem(currentItem.id, { status: 'CANCELLED' });
            break;
          }
        } else {
          updateQueueItem(currentItem.id, {
            status: 'FAILED',
            error: result.error || 'Optimization failed',
          });
        }

        activeProductIdRef.current = null;

        if (isCancelledRef.current) {
          break;
        }

        // Brief breather between products for UI smoothness & API rate limit protection
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (err) {
      console.error('Unexpected error in queue execution:', err);
    } finally {
      // Ensure state cleanup always runs regardless of errors or cancellations
      activeAbortControllerRef.current = null;
      activeProductIdRef.current = null;
      isRunningRef.current = false;
      setIsRunning(false);
      setIsPaused(false);

      // If queue ended in cancelled state, ensure all remaining queued or optimizing items are marked CANCELLED
      if (isCancelledRef.current) {
        setQueueItems((prev) => {
          const next = prev.map((item) =>
            item.status === 'QUEUED' || item.status === 'OPTIMIZING'
              ? { ...item, status: 'CANCELLED' as const }
              : item
          );
          queueItemsRef.current = next;
          return next;
        });
      }

      // Safely update final summary
      try {
        const finalSummary = calculateSummary(queueItemsRef.current);
        setSummary(finalSummary);
      } catch (sumErr) {
        console.error('Failed to calculate final summary:', sumErr);
      }
    }
  };

  // Public: Start Bulk Optimization
  const startBulkOptimization = (selectedIds: string[], products: ProductItem[]) => {
    if (selectedIds.length === 0 || isRunningRef.current) return;

    const initialQueue: BulkOptimizationItem[] = selectedIds
      .map((id) => {
        const prod = products.find((p) => p.id === id);
        if (!prod) return null;

        // Preserve completed status from previous runs so completed items are never automatically rerun
        const existing = queueItemsRef.current.find((q) => q.id === id);
        const isAlreadyCompleted = existing?.status === 'COMPLETED';

        return {
          id: prod.id,
          title: prod.merchantData.title,
          image_link: prod.merchantData.image_link,
          status: isAlreadyCompleted ? ('COMPLETED' as const) : ('QUEUED' as const),
          beforeScore: existing?.beforeScore,
          afterScore: existing?.afterScore,
          appliedFields: existing?.appliedFields,
          retryCount: 0,
        };
      })
      .filter(Boolean) as BulkOptimizationItem[];

    setQueueItems(initialQueue);
    queueItemsRef.current = initialQueue;
    setSummary(null);
    setIsModalOpen(true);
    isPausedRef.current = false;
    isCancelledRef.current = false;
    setIsCancelled(false);

    runSequentialQueue(initialQueue);
  };

  // Public: Pause
  const pause = () => {
    if (!isRunningRef.current) return;
    isPausedRef.current = true;
    setIsPaused(true);
  };

  // Public: Resume
  const resume = () => {
    if (!isRunningRef.current) return;
    isPausedRef.current = false;
    setIsPaused(false);
  };

  // Public: Cancel Remaining
  const cancel = () => {
    isCancelledRef.current = true;
    isPausedRef.current = false;
    setIsCancelled(true);
    setIsPaused(false);

    // Abort active fetch immediately
    if (activeAbortControllerRef.current) {
      try {
        activeAbortControllerRef.current.abort();
      } catch (e) {
        console.error('Error aborting active bulk request:', e);
      }
      activeAbortControllerRef.current = null;
    }

    // Immediately mark remaining QUEUED and currently OPTIMIZING items as CANCELLED in state & ref
    setQueueItems((prev) => {
      const next = prev.map((item) =>
        item.status === 'QUEUED' || item.status === 'OPTIMIZING'
          ? { ...item, status: 'CANCELLED' as const }
          : item
      );
      queueItemsRef.current = next;
      return next;
    });

    // Mark running as false immediately so UI indicators reset without delay
    isRunningRef.current = false;
    setIsRunning(false);

    try {
      const currentSummary = calculateSummary(queueItemsRef.current);
      setSummary(currentSummary);
    } catch (e) {
      console.error('Failed to calculate summary on cancel:', e);
    }
  };

  // Public: Retry Failed or Cancelled items (without rerunning completed products)
  const retryFailed = () => {
    if (isRunningRef.current) return;

    const updated = queueItemsRef.current.map((item) => {
      if (item.status === 'FAILED' || item.status === 'CANCELLED' || item.status === 'SKIPPED') {
        return { ...item, status: 'QUEUED' as const, retryCount: 0, error: undefined };
      }
      // Preserve COMPLETED items untouched
      return item;
    });

    setQueueItems(updated);
    queueItemsRef.current = updated;
    isPausedRef.current = false;
    isCancelledRef.current = false;
    setIsCancelled(false);

    runSequentialQueue(updated);
  };

  // Public: Close Modal (always allowed when stopped, cancelled, or forced)
  const closeModal = (force = false) => {
    if (!isRunningRef.current || isCancelledRef.current || force) {
      setIsModalOpen(false);
    }
  };

  // Public: Open Modal (to review results or restart)
  const openModal = () => {
    setIsModalOpen(true);
  };

  return {
    queueItems,
    isRunning,
    isPaused,
    isCancelled,
    currentIndex,
    summary,
    isModalOpen,
    startBulkOptimization,
    pause,
    resume,
    cancel,
    retryFailed,
    closeModal,
    openModal,
  };
}

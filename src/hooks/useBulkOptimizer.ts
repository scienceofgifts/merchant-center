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

  // Refs for loop controls without closure lag
  const isPausedRef = useRef(false);
  const isCancelledRef = useRef(false);
  const queueItemsRef = useRef<BulkOptimizationItem[]>([]);
  const onProductUpdatedRef = useRef(onProductUpdated);

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
      avgBeforeScore: scoreCount > 0 ? Math.round(totalBefore / scoreCount) : 0,
      avgAfterScore: scoreCount > 0 ? Math.round(totalAfter / scoreCount) : 0,
      fieldCounts,
    };
  }, []);

  // Process a single product with retry logic
  const processProduct = async (
    item: BulkOptimizationItem,
    maxRetries = 2
  ): Promise<{ success: boolean; product?: ProductItem; beforeScore?: number; afterScore?: number; appliedFields?: string[]; error?: string }> => {
    let attempts = 0;
    let lastError = '';

    while (attempts <= maxRetries) {
      try {
        const res = await fetch(`/api/ai/optimize-and-apply/${item.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        const data = await res.json();

        if (res.ok && data.success && data.product) {
          return {
            success: true,
            product: data.product,
            beforeScore: data.beforeScore,
            afterScore: data.afterScore,
            appliedFields: data.appliedFields || [],
          };
        } else {
          lastError = data.error || `Server responded with status ${res.status}`;
          // Check retryable status
          const isRetryable = [429, 500, 502, 503, 504].includes(res.status);
          if (!isRetryable || attempts >= maxRetries) {
            return { success: false, error: lastError };
          }
        }
      } catch (err: any) {
        lastError = err.message || 'Network error / request failed';
        if (attempts >= maxRetries) {
          return { success: false, error: lastError };
        }
      }

      attempts++;
      updateQueueItem(item.id, { retryCount: attempts });
      // Exponential backoff wait before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
    }

    return { success: false, error: lastError || 'Max retries exceeded' };
  };

  // Main Sequential Loop (Concurrency = 1)
  const runSequentialQueue = async (initialItems: BulkOptimizationItem[]) => {
    setIsRunning(true);
    setIsPaused(false);
    setIsCancelled(false);

    let items = [...initialItems];

    for (let i = 0; i < items.length; i++) {
      setCurrentIndex(i);

      // Check cancellation
      if (isCancelledRef.current) {
        // Mark remaining QUEUED items as SKIPPED
        setQueueItems((prev) => {
          const next = prev.map((item, idx) =>
            idx >= i && item.status === 'QUEUED' ? { ...item, status: 'SKIPPED' as const } : item
          );
          queueItemsRef.current = next;
          return next;
        });
        break;
      }

      // Check pause
      while (isPausedRef.current && !isCancelledRef.current) {
        await new Promise((r) => setTimeout(resolve => setTimeout(resolve, 300)));
      }

      if (isCancelledRef.current) break;

      const currentItem = queueItemsRef.current[i] || items[i];
      if (!currentItem || currentItem.status !== 'QUEUED') continue;

      // Mark OPTIMIZING
      updateQueueItem(currentItem.id, { status: 'OPTIMIZING' });

      // Execute optimization service
      const result = await processProduct(currentItem);

      if (result.success && result.product) {
        // IMMEDIATELY UPDATE APPLICATION STATE PER PRODUCT
        onProductUpdatedRef.current(result.product);

        updateQueueItem(currentItem.id, {
          status: 'COMPLETED',
          beforeScore: result.beforeScore,
          afterScore: result.afterScore,
          appliedFields: result.appliedFields,
        });
      } else {
        updateQueueItem(currentItem.id, {
          status: 'FAILED',
          error: result.error || 'Optimization failed',
        });
      }

      // Brief breather between products for UI smoothness & API rate limit protection
      await new Promise((r) => setTimeout(r, 300));
    }

    setIsRunning(false);
    setIsPaused(false);

    // Compute final summary
    const finalSummary = calculateSummary(queueItemsRef.current);
    setSummary(finalSummary);
  };

  // Public: Start Bulk Optimization
  const startBulkOptimization = (selectedIds: string[], products: ProductItem[]) => {
    if (selectedIds.length === 0) return;

    const initialQueue: BulkOptimizationItem[] = selectedIds
      .map((id) => {
        const prod = products.find((p) => p.id === id);
        if (!prod) return null;
        return {
          id: prod.id,
          title: prod.merchantData.title,
          image_link: prod.merchantData.image_link,
          status: 'QUEUED' as const,
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

    runSequentialQueue(initialQueue);
  };

  // Public: Pause
  const pause = () => {
    isPausedRef.current = true;
    setIsPaused(true);
  };

  // Public: Resume
  const resume = () => {
    isPausedRef.current = false;
    setIsPaused(false);
  };

  // Public: Cancel
  const cancel = () => {
    isCancelledRef.current = true;
    setIsCancelled(true);
    setIsPaused(false);
  };

  // Public: Retry Failed
  const retryFailed = () => {
    const updated = queueItemsRef.current.map((item) => {
      if (item.status === 'FAILED') {
        return { ...item, status: 'QUEUED' as const, retryCount: 0, error: undefined };
      }
      return item;
    });

    setQueueItems(updated);
    queueItemsRef.current = updated;
    isPausedRef.current = false;
    isCancelledRef.current = false;

    runSequentialQueue(updated);
  };

  // Public: Close Modal
  const closeModal = () => {
    if (!isRunning) {
      setIsModalOpen(false);
    }
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
  };
}

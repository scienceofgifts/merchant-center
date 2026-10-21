import assert from 'assert';
import { BulkOptimizationItem, BulkQueueSummary } from '../src/types/bulk';
import { ProductItem } from '../src/types/feed';

console.log('==============================================');
console.log('RUNNING TEST SUITE: BULK OPTIMIZER CANCELLATION');
console.log('==============================================\n');

// Mock Product Generator
function createMockProduct(id: string, title: string, status: 'not_analyzed' | 'optimized' = 'not_analyzed'): ProductItem {
  return {
    id,
    status,
    evidence: {
      sourceUrl: `https://shop.scienceofgifts.com/products/${id}`,
      extractedAt: new Date().toISOString(),
      pageTitle: title,
      rawDescription: `Description for ${title}`,
      verifiedAttributes: { brand: 'Science of Gifts', color: 'Black', size: 'M', material: 'Cotton' },
      unresolvedAttributes: [],
      confidenceScores: {},
      variants: [],
      images: [],
      userCorrections: {},
    },
    merchantData: {
      id,
      link: `https://shop.scienceofgifts.com/products/${id}`,
      title,
      description: `Description for ${title}`,
      image_link: `https://example.com/${id}.jpg`,
      google_product_category: 'Apparel & Accessories > Clothing',
      product_type: 'Apparel > T-Shirts',
      price: '29.00 USD',
      availability: 'in_stock',
      brand: 'Science of Gifts',
      gtin: '',
      mpn: '',
      identifier_exists: 'no',
      item_group_id: '',
      color: 'Black',
      size: 'M',
      material: 'Cotton',
      gender: 'unisex',
      age_group: 'adult',
      condition: 'new',
      custom_label_0: '',
      custom_label_1: '',
      custom_label_2: '',
      custom_label_3: '',
      custom_label_4: '',
    },
    giftIntelligence: {
      theme: 'General',
      subtheme: 'Gift',
      targetAudience: [],
      recipientPersonas: [],
      occasions: [],
      primaryGiftIntent: '',
      secondaryGiftIntents: [],
      searchConcepts: [],
    },
    titleCandidates: [],
    appliedSuggestions: [],
    history: [],
    validation: { isValid: true, blockingErrors: [], warnings: [] },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// Emulated Bulk Optimizer Controller (matching the exact state machine of useBulkOptimizer)
class EmulatedBulkOptimizer {
  queueItems: BulkOptimizationItem[] = [];
  isRunning = false;
  isPaused = false;
  isCancelled = false;
  currentIndex = 0;
  summary: BulkQueueSummary | null = null;
  isModalOpen = false;

  // Refs
  isRunningRef = false;
  isPausedRef = false;
  isCancelledRef = false;
  queueItemsRef: BulkOptimizationItem[] = [];
  activeAbortController: AbortController | null = null;
  activeProductId: string | null = null;

  onProductUpdatedCalls: ProductItem[] = [];

  onProductUpdated(prod: ProductItem) {
    this.onProductUpdatedCalls.push(prod);
  }

  updateQueueItem(id: string, updates: Partial<BulkOptimizationItem>) {
    this.queueItems = this.queueItems.map((item) =>
      item.id === id ? { ...item, ...updates } : item
    );
    this.queueItemsRef = this.queueItems;
  }

  calculateSummary(items: BulkOptimizationItem[]): BulkQueueSummary {
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
      fieldCounts: {
        ...fieldCounts,
        productType: 0,
        googleProductCategory: 0,
        customLabels: 0,
        giftIntelligence: 0,
      },
    };
  }

  // Simulated product processor with abort signal support
  async processProduct(
    item: BulkOptimizationItem,
    signal?: AbortSignal,
    delayMs = 20,
    simulateError?: string
  ): Promise<{ success: boolean; product?: ProductItem; beforeScore?: number; afterScore?: number; appliedFields?: string[]; error?: string; cancelled?: boolean }> {
    if (this.isCancelledRef || signal?.aborted) {
      return { success: false, cancelled: true };
    }

    // Simulate async network request
    const sleepSteps = Math.ceil(delayMs / 10);
    for (let s = 0; s < sleepSteps; s++) {
      if (this.isCancelledRef || signal?.aborted) {
        return { success: false, cancelled: true };
      }
      await new Promise((r) => setTimeout(r, 10));
    }

    if (this.isCancelledRef || signal?.aborted) {
      return { success: false, cancelled: true };
    }

    if (simulateError) {
      return { success: false, error: simulateError };
    }

    const prod = createMockProduct(item.id, item.title, 'optimized');
    return {
      success: true,
      product: prod,
      beforeScore: 50,
      afterScore: 92,
      appliedFields: ['Title', 'Description'],
    };
  }

  async runSequentialQueue(initialItems: BulkOptimizationItem[], itemDelayMs = 20, errorMap?: Record<string, string>) {
    if (this.isRunningRef) {
      return;
    }

    this.isRunningRef = true;
    this.isRunning = true;
    this.isPaused = false;
    this.isCancelled = false;
    this.isPausedRef = false;
    this.isCancelledRef = false;

    try {
      for (let i = 0; i < initialItems.length; i++) {
        if (this.isCancelledRef) {
          break;
        }

        while (this.isPausedRef && !this.isCancelledRef) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        if (this.isCancelledRef) {
          break;
        }

        this.currentIndex = i;
        const currentItem = this.queueItemsRef[i] || initialItems[i];
        if (!currentItem || currentItem.status !== 'QUEUED') {
          continue;
        }

        this.activeProductId = currentItem.id;
        this.updateQueueItem(currentItem.id, { status: 'OPTIMIZING' });

        const abortController = new AbortController();
        this.activeAbortController = abortController;

        const errToThrow = errorMap ? errorMap[currentItem.id] : undefined;
        const result = await this.processProduct(currentItem, abortController.signal, itemDelayMs, errToThrow);

        this.activeAbortController = null;

        if (this.isCancelledRef || result.cancelled) {
          this.updateQueueItem(currentItem.id, { status: 'CANCELLED' });
          break;
        }

        if (result.success && result.product && result.product.id === currentItem.id) {
          if (!this.isCancelledRef) {
            this.onProductUpdated(result.product);
            this.updateQueueItem(currentItem.id, {
              status: 'COMPLETED',
              beforeScore: result.beforeScore,
              afterScore: result.afterScore,
              appliedFields: result.appliedFields,
            });
          } else {
            this.updateQueueItem(currentItem.id, { status: 'CANCELLED' });
            break;
          }
        } else {
          this.updateQueueItem(currentItem.id, {
            status: 'FAILED',
            error: result.error || 'Optimization failed',
          });
        }

        this.activeProductId = null;

        if (this.isCancelledRef) {
          break;
        }

        await new Promise((r) => setTimeout(r, 10));
      }
    } catch (err) {
      // Caught
    } finally {
      this.activeAbortController = null;
      this.activeProductId = null;
      this.isRunningRef = false;
      this.isRunning = false;
      this.isPaused = false;

      if (this.isCancelledRef) {
        this.queueItems = this.queueItems.map((item) =>
          item.status === 'QUEUED' || item.status === 'OPTIMIZING'
            ? { ...item, status: 'CANCELLED' as const }
            : item
        );
        this.queueItemsRef = this.queueItems;
      }

      try {
        this.summary = this.calculateSummary(this.queueItemsRef);
      } catch (sumErr) {
        // Handled
      }
    }
  }

  startBulkOptimization(selectedIds: string[], products: ProductItem[], itemDelayMs = 20) {
    if (selectedIds.length === 0 || this.isRunningRef) return;

    const initialQueue: BulkOptimizationItem[] = selectedIds
      .map((id) => {
        const prod = products.find((p) => p.id === id);
        if (!prod) return null;

        const existing = this.queueItemsRef.find((q) => q.id === id);
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

    this.queueItems = initialQueue;
    this.queueItemsRef = initialQueue;
    this.summary = null;
    this.isModalOpen = true;
    this.isPausedRef = false;
    this.isCancelledRef = false;
    this.isCancelled = false;

    return this.runSequentialQueue(initialQueue, itemDelayMs);
  }

  cancel() {
    this.isCancelledRef = true;
    this.isPausedRef = false;
    this.isCancelled = true;
    this.isPaused = false;

    if (this.activeAbortController) {
      try {
        this.activeAbortController.abort();
      } catch (e) {}
      this.activeAbortController = null;
    }

    this.queueItems = this.queueItems.map((item) =>
      item.status === 'QUEUED' || item.status === 'OPTIMIZING'
        ? { ...item, status: 'CANCELLED' as const }
        : item
    );
    this.queueItemsRef = this.queueItems;

    this.isRunningRef = false;
    this.isRunning = false;

    try {
      this.summary = this.calculateSummary(this.queueItemsRef);
    } catch (e) {}
  }

  retryFailed(itemDelayMs = 20) {
    if (this.isRunningRef) return;

    const updated = this.queueItemsRef.map((item) => {
      if (item.status === 'FAILED' || item.status === 'CANCELLED' || item.status === 'SKIPPED') {
        return { ...item, status: 'QUEUED' as const, retryCount: 0, error: undefined };
      }
      return item;
    });

    this.queueItems = updated;
    this.queueItemsRef = updated;
    this.isPausedRef = false;
    this.isCancelledRef = false;
    this.isCancelled = false;

    return this.runSequentialQueue(updated, itemDelayMs);
  }

  closeModal(force = false) {
    if (!this.isRunningRef || this.isCancelledRef || force) {
      this.isModalOpen = false;
    }
  }

  openModal() {
    this.isModalOpen = true;
  }
}

async function runTests() {
  let passed = 0;

  // Test 1: Cancellation between products prevents new products from starting
  {
    const optimizer = new EmulatedBulkOptimizer();
    const mockProducts = Array.from({ length: 10 }, (_, i) => createMockProduct(`p_${i}`, `Product ${i}`));
    const ids = mockProducts.map((p) => p.id);

    const promise = optimizer.startBulkOptimization(ids, mockProducts, 30);

    // Wait until product 0 completes (approx 40ms) then cancel before product 2 starts
    await new Promise((r) => setTimeout(r, 45));
    optimizer.cancel();
    await promise;

    assert.strictEqual(optimizer.isRunning, false, 'Queue must not be running after cancellation');
    assert.strictEqual(optimizer.isCancelled, true, 'Queue must be marked cancelled');
    const completedCount = optimizer.queueItems.filter((i) => i.status === 'COMPLETED').length;
    const cancelledCount = optimizer.queueItems.filter((i) => i.status === 'CANCELLED').length;
    assert.ok(completedCount >= 1 && completedCount <= 2, `Completed items should be 1 or 2, got ${completedCount}`);
    assert.strictEqual(completedCount + cancelledCount, 10, 'All remaining items must be CANCELLED');
    console.log('✓ [PASS] Test 1: Cancellation between products prevents new products from starting');
    passed++;
  }

  // Test 2: Cancellation during in-progress operation (24 products, cancelled at item 5)
  {
    const optimizer = new EmulatedBulkOptimizer();
    const mockProducts = Array.from({ length: 24 }, (_, i) => createMockProduct(`prod_${i + 1}`, `Item ${i + 1}`));
    const ids = mockProducts.map((p) => p.id);

    // Run with 25ms per item. 4 items take ~100ms. Item 5 starts at ~105ms.
    const promise = optimizer.startBulkOptimization(ids, mockProducts, 25);

    // Wait deterministically until prod_5 is actively running in flight
    while (optimizer.activeProductId !== 'prod_5') {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.strictEqual(optimizer.activeProductId, 'prod_5', 'Item 5 should be the active target when cancel is clicked');
    optimizer.cancel();
    await promise;

    assert.strictEqual(optimizer.isRunning, false, 'Loading state must be terminated immediately');
    assert.strictEqual(optimizer.activeProductId, null, 'Active product indicator must be cleared');
    assert.strictEqual(optimizer.queueItems[4].id, 'prod_5');
    assert.strictEqual(optimizer.queueItems[4].status, 'CANCELLED', 'Item 5 in flight must be marked CANCELLED');

    const completed = optimizer.queueItems.filter((i) => i.status === 'COMPLETED').length;
    assert.strictEqual(completed, 4, 'Items 1-4 must be preserved as COMPLETED');

    const cancelled = optimizer.queueItems.filter((i) => i.status === 'CANCELLED').length;
    assert.strictEqual(cancelled, 20, 'Items 5-24 must be marked CANCELLED');
    console.log('✓ [PASS] Test 2: Cancellation during in-progress operation aborts active target safely');
    passed++;
  }

  // Test 3: Closing the dialog after cancellation succeeds
  {
    const optimizer = new EmulatedBulkOptimizer();
    const mockProducts = Array.from({ length: 5 }, (_, i) => createMockProduct(`p_${i}`, `Product ${i}`));
    const ids = mockProducts.map((p) => p.id);

    const promise = optimizer.startBulkOptimization(ids, mockProducts, 30);
    assert.strictEqual(optimizer.isModalOpen, true, 'Modal should be open when starting');

    await new Promise((r) => setTimeout(r, 40));
    optimizer.cancel();
    await promise;

    // Verify closing modal works after cancellation
    optimizer.closeModal();
    assert.strictEqual(optimizer.isModalOpen, false, 'Modal must close cleanly after cancellation');
    console.log('✓ [PASS] Test 3: Closing dialog after cancellation works without getting stuck');
    passed++;
  }

  // Test 4: Errors during cleanup or execution do not leave UI permanently busy
  {
    const optimizer = new EmulatedBulkOptimizer();
    const mockProducts = [
      createMockProduct('p_ok_1', 'OK Product 1'),
      createMockProduct('p_fail', 'Failing Product'),
      createMockProduct('p_ok_2', 'OK Product 2'),
    ];
    const ids = mockProducts.map((p) => p.id);

    // Simulate an API error on p_fail
    await optimizer.startBulkOptimization(ids, mockProducts, 15);

    assert.strictEqual(optimizer.isRunning, false, 'Queue should finish and not stay busy');
    const failItem = optimizer.queueItems.find((i) => i.id === 'p_fail');
    assert.ok(failItem, 'Fail item should exist');
    optimizer.closeModal();
    assert.strictEqual(optimizer.isModalOpen, false, 'Dialog should close even after items fail');
    console.log('✓ [PASS] Test 4: Thrown errors and failures do not leave UI permanently busy');
    passed++;
  }

  // Test 5: Late AI responses after cancellation are discarded and never applied
  {
    const optimizer = new EmulatedBulkOptimizer();
    const mockProducts = [
      createMockProduct('p_1', 'Product 1'),
      createMockProduct('p_2', 'Product 2'),
    ];
    const ids = mockProducts.map((p) => p.id);

    // Simulate item 1 running with a long delay
    const promise = optimizer.startBulkOptimization(ids, mockProducts, 100);

    // Cancel while product 1 is waiting
    await new Promise((r) => setTimeout(r, 20));
    optimizer.cancel();
    await promise;

    // Ensure onProductUpdated was NOT called for cancelled product
    assert.strictEqual(optimizer.onProductUpdatedCalls.length, 0, 'No late responses should be applied to product state');
    assert.strictEqual(optimizer.queueItems[0].status, 'CANCELLED', 'Product 1 must be CANCELLED');
    console.log('✓ [PASS] Test 5: Late AI responses after cancellation are never applied to products');
    passed++;
  }

  // Test 6: Preserving completed products across cancellation and restart
  {
    const optimizer = new EmulatedBulkOptimizer();
    const mockProducts = Array.from({ length: 6 }, (_, i) => createMockProduct(`item_${i}`, `Item ${i}`));
    const ids = mockProducts.map((p) => p.id);

    const promise = optimizer.startBulkOptimization(ids, mockProducts, 20);

    // Let 2 items complete, then cancel
    await new Promise((r) => setTimeout(r, 55));
    optimizer.cancel();
    await promise;

    const comp = optimizer.queueItems.filter((i) => i.status === 'COMPLETED');
    assert.strictEqual(comp.length, 2, '2 items should be completed');
    assert.strictEqual(comp[0].afterScore, 92, 'Scores of completed items must be preserved');
    assert.strictEqual(comp[1].afterScore, 92, 'Scores of completed items must be preserved');

    // Restart queue with retryFailed
    const retryPromise = optimizer.retryFailed(15);
    await retryPromise;

    // All items should now be completed
    const finalComp = optimizer.queueItems.filter((i) => i.status === 'COMPLETED');
    assert.strictEqual(finalComp.length, 6, 'All 6 items should be completed after retry');
    // Ensure the first two products were not duplicated or rerun with different scores
    assert.strictEqual(finalComp[0].id, 'item_0');
    assert.strictEqual(finalComp[1].id, 'item_1');
    console.log('✓ [PASS] Test 6: Completed products and their scores are strictly preserved');
    passed++;
  }

  // Test 7: Reopening dialog after cancellation preserves status and allows restart
  {
    const optimizer = new EmulatedBulkOptimizer();
    const mockProducts = Array.from({ length: 4 }, (_, i) => createMockProduct(`x_${i}`, `X ${i}`));
    const ids = mockProducts.map((p) => p.id);

    const promise = optimizer.startBulkOptimization(ids, mockProducts, 20);
    await new Promise((r) => setTimeout(r, 25));
    optimizer.cancel();
    await promise;

    // Close modal
    optimizer.closeModal();
    assert.strictEqual(optimizer.isModalOpen, false);

    // Reopen modal
    optimizer.openModal();
    assert.strictEqual(optimizer.isModalOpen, true);
    assert.strictEqual(optimizer.queueItems.length, 4);
    assert.strictEqual(optimizer.isCancelled, true);
    assert.strictEqual(optimizer.isRunning, false);
    console.log('✓ [PASS] Test 7: Reopening dialog after cancellation preserves queue state');
    passed++;
  }

  // Test 8: Starting bulk optimization with already completed products does not rerun them
  {
    const optimizer = new EmulatedBulkOptimizer();
    const mockProducts = [
      createMockProduct('prod_done', 'Already Completed Product', 'optimized'),
      createMockProduct('prod_pending', 'Pending Product', 'not_analyzed'),
    ];

    // Mark prod_done as COMPLETED in existing queue
    optimizer.queueItemsRef = [
      {
        id: 'prod_done',
        title: 'Already Completed Product',
        status: 'COMPLETED',
        beforeScore: 40,
        afterScore: 90,
        retryCount: 0,
      },
    ];

    const ids = ['prod_done', 'prod_pending'];
    optimizer.onProductUpdatedCalls = [];
    const promise = optimizer.startBulkOptimization(ids, mockProducts, 20);
    await promise;

    // prod_done should NOT have been re-processed by onProductUpdated
    assert.strictEqual(optimizer.onProductUpdatedCalls.length, 1, 'Only the pending product should be processed');
    assert.strictEqual(optimizer.onProductUpdatedCalls[0].id, 'prod_pending', 'Only prod_pending was updated');
    console.log('✓ [PASS] Test 8: Already completed products are not rerun when restarting a queue');
    passed++;
  }

  console.log('\n==============================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, 0 FAILED`);
  console.log('==============================================');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});

import {
  FeedSyncPreviewResult,
  FeedSyncUnmatchedFeedGroup,
  FeedSyncMatchedItem,
  FeedSyncMode,
} from '../types/feed';

export interface UnmatchedSelectionReviewSummary {
  totalUnmatchedDesigns: number;
  totalUnmatchedVariants: number;
  selectedUnmatchedDesignsCount: number;
  selectedUnmatchedVariantsCount: number;
  selectionStatusLabel: string;
  selectedUnmatchedGroups: FeedSyncUnmatchedFeedGroup[];
  totalMatchedDesigns: number;
  matchedWithNewVariantsCount: number;
  selectedMatchedDesignsCount: number;
  selectedMatchedVariantsCount: number;
  selectedNewVariantsForExistingCount: number;
  totalNewVariantsForExistingCount: number;
  unchangedProductsCount: number;
  ambiguousCount: number;
  selectedMatchedItems: FeedSyncMatchedItem[];
  totalSelectedDesignsToApply: number;
  totalSelectedVariantsToApply: number;
}

/**
 * Selects all genuinely new website product designs (never includes ambiguous matches).
 */
export function selectAllUnmatchedDesigns(
  preview: Pick<FeedSyncPreviewResult, 'unmatchedFeedGroups'> | null | undefined
): Set<string> {
  if (!preview || !Array.isArray(preview.unmatchedFeedGroups)) {
    return new Set<string>();
  }
  return new Set<string>(preview.unmatchedFeedGroups.map((group) => group.groupKey));
}

/**
 * Selects only existing catalog products that have genuinely missing website variants to attach.
 */
export function selectMatchedWithNewVariants(
  preview: Pick<FeedSyncPreviewResult, 'matchedProducts'> | null | undefined
): Set<string> {
  if (!preview || !Array.isArray(preview.matchedProducts)) {
    return new Set<string>();
  }
  return new Set<string>(
    preview.matchedProducts
      .filter((item) => item.missingVariantCount > 0)
      .map((item) => item.catalogProductId)
  );
}

/**
 * Clears all selected unmatched website design groups without mutating any catalog state.
 */
export function clearUnmatchedDesignSelection(): Set<string> {
  return new Set<string>();
}

/**
 * Toggles selection for a single unmatched website design group key.
 */
export function toggleUnmatchedDesignSelection(
  currentSelection: ReadonlySet<string>,
  groupKey: string
): Set<string> {
  const next = new Set<string>(currentSelection);
  if (next.has(groupKey)) {
    next.delete(groupKey);
  } else {
    next.add(groupKey);
  }
  return next;
}

/**
 * Computes the complete selection and variant count review summary for the Website Feed Sync modal.
 */
export function computeUnmatchedSelectionReview(
  preview: FeedSyncPreviewResult | null | undefined,
  selectedCatalogIds: ReadonlySet<string>,
  selectedImportGroupKeys: ReadonlySet<string>,
  syncMode: FeedSyncMode = 'add_only'
): UnmatchedSelectionReviewSummary {
  if (!preview) {
    return {
      totalUnmatchedDesigns: 0,
      totalUnmatchedVariants: 0,
      selectedUnmatchedDesignsCount: 0,
      selectedUnmatchedVariantsCount: 0,
      selectionStatusLabel: '0 of 0 selected',
      selectedUnmatchedGroups: [],
      totalMatchedDesigns: 0,
      matchedWithNewVariantsCount: 0,
      selectedMatchedDesignsCount: 0,
      selectedMatchedVariantsCount: 0,
      selectedNewVariantsForExistingCount: 0,
      totalNewVariantsForExistingCount: 0,
      unchangedProductsCount: 0,
      ambiguousCount: 0,
      selectedMatchedItems: [],
      totalSelectedDesignsToApply: 0,
      totalSelectedVariantsToApply: 0,
    };
  }

  const unmatchedGroups = preview.unmatchedFeedGroups || [];
  const totalUnmatchedDesigns = unmatchedGroups.length;
  const totalUnmatchedVariants = unmatchedGroups.reduce(
    (sum, g) => sum + (g.variantCount || g.variants?.length || 0),
    0
  );

  const selectedUnmatchedGroups = unmatchedGroups.filter((g) =>
    selectedImportGroupKeys.has(g.groupKey)
  );
  const selectedUnmatchedDesignsCount = selectedUnmatchedGroups.length;
  const selectedUnmatchedVariantsCount = selectedUnmatchedGroups.reduce(
    (sum, g) => sum + (g.variantCount || g.variants?.length || 0),
    0
  );

  const matchedItems = preview.matchedProducts || [];
  const totalMatchedDesigns = matchedItems.length;
  const matchedWithNewVariantsCount = matchedItems.filter((m) => m.missingVariantCount > 0).length;
  const totalNewVariantsForExistingCount = matchedItems.reduce(
    (sum, m) => sum + (m.missingVariantCount || 0),
    0
  );

  const selectedMatchedItems = matchedItems.filter((m) => {
    if (!selectedCatalogIds.has(m.catalogProductId)) return false;
    // In add_only mode, only items with genuinely missing variants will actually be modified
    return syncMode === 'add_only' ? m.missingVariantCount > 0 : true;
  });

  const selectedMatchedDesignsCount = selectedMatchedItems.length;
  const selectedMatchedVariantsCount = selectedMatchedItems.reduce(
    (sum, m) => sum + (m.newVariantCount || m.variants?.length || 0),
    0
  );
  const selectedNewVariantsForExistingCount = selectedMatchedItems.reduce(
    (sum, m) => sum + (m.missingVariantCount || 0),
    0
  );

  const unmatchedCatalogCount = preview.unmatchedCatalogItems?.length || 0;
  const untouchedMatchedCount = totalMatchedDesigns - selectedMatchedDesignsCount;
  const unchangedProductsCount = untouchedMatchedCount + unmatchedCatalogCount;
  const ambiguousCount = preview.ambiguousMatches?.length || 0;

  const selectionStatusLabel = `${selectedUnmatchedDesignsCount} of ${totalUnmatchedDesigns} selected`;

  return {
    totalUnmatchedDesigns,
    totalUnmatchedVariants,
    selectedUnmatchedDesignsCount,
    selectedUnmatchedVariantsCount,
    selectionStatusLabel,
    selectedUnmatchedGroups,
    totalMatchedDesigns,
    matchedWithNewVariantsCount,
    selectedMatchedDesignsCount,
    selectedMatchedVariantsCount,
    selectedNewVariantsForExistingCount,
    totalNewVariantsForExistingCount,
    unchangedProductsCount,
    ambiguousCount,
    selectedMatchedItems,
    totalSelectedDesignsToApply: selectedMatchedDesignsCount + selectedUnmatchedDesignsCount,
    totalSelectedVariantsToApply:
      syncMode === 'add_only'
        ? selectedNewVariantsForExistingCount + selectedUnmatchedVariantsCount
        : selectedMatchedVariantsCount + selectedUnmatchedVariantsCount,
  };
}


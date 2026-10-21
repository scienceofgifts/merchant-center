export type BulkItemStatus =
  | 'READY'
  | 'QUEUED'
  | 'OPTIMIZING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED';

export interface BulkOptimizationItem {
  id: string;
  title: string;
  image_link?: string;
  status: BulkItemStatus;
  beforeScore?: number;
  afterScore?: number;
  appliedFields?: string[];
  autoFixedIssues?: string[];
  error?: string;
  retryCount: number;
}

export interface BulkQueueSummary {
  totalSelected: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  avgBeforeScore: number;
  avgAfterScore: number;
  fieldCounts: {
    title: number;
    description: number;
    productType: number;
    googleProductCategory: number;
    customLabels: number;
    giftIntelligence: number;
  };
}

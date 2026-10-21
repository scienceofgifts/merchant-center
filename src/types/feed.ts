export interface VerifiedAttributes {
  material?: string;
  color?: string;
  size?: string;
  capacity?: string;
  brand?: string;
  gtin?: string;
  mpn?: string;
  sku?: string;
  dimensions?: string;
  weight?: string;
  careInstructions?: string;
  originCountry?: string;
  features?: string[];
  customAttributes?: Record<string, string>;
}

export interface ProductVariant {
  id: string;
  title: string;
  price?: string;
  sku?: string;
  color?: string;
  size?: string;
  capacity?: string;
  material?: string;
  image?: string;
  available?: boolean;
}

export interface OpenGraphData {
  title?: string;
  description?: string;
  image?: string;
  price?: string;
  currency?: string;
  availability?: string;
  site_name?: string;
}

export interface EvidenceModel {
  sourceUrl: string;
  extractedAt: string;
  pageTitle: string;
  rawDescription: string;
  jsonLd?: Record<string, any>;
  openGraph?: OpenGraphData;
  verifiedAttributes: VerifiedAttributes;
  unresolvedAttributes: string[];
  confidenceScores: Record<string, number>;
  variants: ProductVariant[];
  images: string[];
  userCorrections: Record<string, string>;
}

export interface MerchantData {
  id: string;
  link: string;
  title: string;
  description: string;
  image_link: string;
  additional_image_link?: string;
  google_product_category: string;
  product_type: string;
  price: string;
  sale_price?: string;
  availability: 'in_stock' | 'out_of_stock' | 'preorder' | 'backorder';
  brand: string;
  gtin: string;
  mpn: string;
  identifier_exists: 'yes' | 'no';
  item_group_id: string;
  color: string;
  size: string;
  material: string;
  gender: 'unisex' | 'male' | 'female' | '';
  age_group: 'adult' | 'all_ages' | 'teen' | 'kids' | 'toddler' | 'infant' | '';
  condition: 'new' | 'refurbished' | 'used';
  pattern?: string;
  size_type?: 'regular' | 'petite' | 'plus' | 'big_and_tall' | 'maternity' | '';
  custom_label_0: string; // Default: Gift Audience
  custom_label_1: string; // Default: Price Tier
  custom_label_2: string; // Default: Seasonality
  custom_label_3: string; // Default: Theme / Collection
  custom_label_4: string; // Default: Product Type
}

export interface GiftIntelligence {
  theme: string;
  subtheme: string;
  targetAudience: string[];
  recipientPersonas: string[];
  occasions: string[];
  primaryGiftIntent: string;
  secondaryGiftIntents: string[];
  searchConcepts: string[];
}

export interface TitleCandidate {
  id: string;
  title: string;
  formula: string;
  titlePriorityOrder?: string[];
  titleStrategyReasoning?: string;
  scores: {
    coreThemeProminence: number;
    giftSearchRelevance: number;
    productClarity: number;
    naturalLanguage: number;
    factualAccuracy: number;
    differentiation: number;
    characterEfficiency: number;
    total: number;
  };
  reasoning: string;
}

export interface AIStrategy {
  exactProductSummary: string;
  dominantTheme: string;
  productCategory: string;
  verifiedPhysicalAttributes: string[];
  realisticBuyer: string;
  realisticRecipient: string;
  giftRationale: string;
  relevantSearchIntents: string[];
  differentiatingAttributes: string[];
  titleStrategy: string;
  titlePriorityOrder?: string[];
  titleStrategyReasoning?: string;
  descriptionStrategy: string;
  productTypeStrategy: string;
  customLabelsStrategy: Record<string, string>;
  antiRecommendations: string[];
  googleCategoryRationale: string;
  recommendedGoogleCategory: string;
  researchedAt: string;
}

export type AuditIssueState = 'safe_to_fix' | 'requires_review' | 'informational' | 'fixed';

export interface AuditIssue {
  id: string;
  field: string;
  title: string;
  description: string;
  state: AuditIssueState;
  verifiedEvidence?: string;
  suggestedFix: string;
  isFixed?: boolean;
  fixedValue?: any;
  error?: string;
}

export interface AIAudit {
  overallScore: number;
  previousScore?: number;
  fieldScores: {
    accuracy: number;
    searchRelevance: number;
    giftRelevance: number;
    taxonomy: number;
    description: number;
    naturalLanguage: number;
    compliance: number;
  };
  issues: AuditIssue[];
  warnings: string[];
  criticalErrors: string[];
  suggestedFixes: Array<{ field: string; issue: string; fix: string }>;
  fixedAutomatically?: string[];
  auditedAt: string;
}

export interface DeterministicValidation {
  isValid: boolean;
  blockingErrors: string[];
  warnings: string[];
}

export type ProductStatus = 'not_analyzed' | 'needs_review' | 'warnings' | 'errors' | 'optimized';

export type FieldProvenanceStatus =
  | 'VERIFIED'
  | 'GENERATED'
  | 'OPTIMIZED'
  | 'USER_EDITED'
  | 'UNVERIFIED'
  | 'UNAVAILABLE';

export type FieldProvenanceMap = Record<
  string,
  {
    status: FieldProvenanceStatus;
    source?: string;
    note?: string;
    updatedAt?: string;
  }
>;

export interface OptimizationSummary {
  timestamp: string;
  beforeScore: number;
  afterScore: number;
  appliedFields: string[];
  autoFixedIssues: string[];
  remainingReviewCount: number;
  generatedCount?: number;
  optimizedCount?: number;
  verifiedCount?: number;
}

export interface ProductSubgroupConfig {
  id: string;
  name: string;
  description?: string;
}

export interface ProductGroupConfig {
  id: string;
  name: string;
  subgroups: string[];
  description?: string;
}

export interface ProductItem {
  id: string;
  productGroup?: string;
  productSubgroup?: string;
  status: ProductStatus;
  evidence: EvidenceModel;
  merchantData: MerchantData;
  suggestedMerchantData?: Partial<MerchantData>;
  giftIntelligence: GiftIntelligence;
  suggestedGiftIntelligence?: Partial<GiftIntelligence>;
  titleCandidates: TitleCandidate[];
  selectedTitleCandidateId?: string;
  strategy?: AIStrategy;
  audit?: AIAudit;
  validation: DeterministicValidation;
  fieldProvenance?: Record<string, FieldProvenanceStatus>;
  fieldProvenanceDetails?: FieldProvenanceMap;
  originalImported?: Partial<MerchantData>;
  lastOptimizationSummary?: OptimizationSummary;
  appliedSuggestions: Array<{ timestamp: string; fields: string[]; note: string }>;
  history: Array<{ timestamp: string; note: string; snapshot: Partial<MerchantData> }>;
  createdAt: string;
  updatedAt: string;
}

export interface ThemeConfig {
  id: string;
  name: string;
  subthemes: string[];
  keywords: string[];
}

export interface GiftAudienceConfig {
  id: string;
  name: string;
  description: string;
}

export interface PriceTierConfig {
  id: string;
  label: string;
  min: number;
  max?: number;
}

export interface GoogleCategoryOption {
  id: string;
  name: string;
  fullPath: string;
  suggestedProductType: string;
  defaultAttributes?: {
    age_group?: 'adult' | 'all_ages' | 'teen' | 'kids' | 'toddler' | 'infant';
    gender?: 'unisex' | 'male' | 'female';
  };
}

export interface StrategyConfig {
  productGroups: ProductGroupConfig[];
  themes: ThemeConfig[];
  giftAudiences: GiftAudienceConfig[];
  recipientPersonas: string[];
  occasions: string[];
  priceTiers: PriceTierConfig[];
  seasonality: string[];
  customLabelMappings: {
    custom_label_0: string;
    custom_label_1: string;
    custom_label_2: string;
    custom_label_3: string;
    custom_label_4: string;
  };
  geminiModel: string;
  googleTaxonomyPresets: GoogleCategoryOption[];
}

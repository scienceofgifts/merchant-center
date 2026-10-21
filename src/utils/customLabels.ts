import { ProductItem, StrategyConfig, MerchantData, PriceTierConfig } from '../types/feed';
import { INITIAL_STRATEGY_CONFIG } from './taxonomy';

export interface CustomLabelsAllocation {
  custom_label_0: string; // Gift Audience
  custom_label_1: string; // Price Tier
  custom_label_2: string; // Seasonality
  custom_label_3: string; // Theme / Niche
  custom_label_4: string; // Product Type
}

export interface CustomLabelAnomalies {
  hasMisallocatedLabels: boolean;
  issues: string[];
  recommendedLabels: CustomLabelsAllocation;
}

/**
 * Checks if a string looks like a price or price tier expression rather than an audience, theme, or product type.
 */
export function isPriceLikeString(str: string): boolean {
  if (!str) return false;
  const s = str.trim();
  if (/\b(?:usd|eur|gbp|cad|aud)\b/i.test(s)) return true;
  if (/[$€£]/.test(s)) return true;
  if (/\bunder\s+\d+/i.test(s)) return true;
  if (/\b(?:budget|mid-tier|premium|deluxe)\s+gifts?\b/i.test(s)) return true;
  if (/[<>]\s*\$?\d+/i.test(s)) return true;
  if (/\$?\d+\s*-\s*\$?\d+/.test(s)) return true;
  return false;
}

/**
 * Checks if a string looks like a physical product type (e.g. T-Shirt, Mug, Poster, Apparel).
 */
export function isProductTypeLikeString(str: string): boolean {
  if (!str) return false;
  const s = str.toLowerCase().trim();
  return (
    s === 't-shirt' ||
    s === 't-shirts' ||
    s === 'hoodie' ||
    s === 'hoodies' ||
    s === 'mug' ||
    s === 'mugs' ||
    s === 'poster' ||
    s === 'posters' ||
    s === 'water bottle' ||
    s === 'water bottles' ||
    s === 'whiskey glass' ||
    s === 'beer glass' ||
    s === 'drinkware' ||
    s === 'apparel' ||
    s === 'decor' ||
    s === 'desk mat' ||
    s === 'desk mats' ||
    s === 'journal' ||
    s === 'notebook' ||
    s === 'cap' ||
    s === 'hat' ||
    s === 'tote bag' ||
    s === 'apparel / drinkware / decor' ||
    s.includes('t-shirt') ||
    s.includes('hoodie') ||
    s.includes('sweatshirt')
  );
}

/**
 * Derives the Merchant Center Price Tier (custom_label_1) from the actual product price.
 * Strictly adheres to configured price bands.
 */
export function derivePriceTier(
  price: string | number | undefined,
  priceTiers?: PriceTierConfig[]
): string {
  const tiers: PriceTierConfig[] =
    priceTiers && priceTiers.length > 0 ? priceTiers : INITIAL_STRATEGY_CONFIG.priceTiers;

  let numPrice = 25;
  if (typeof price === 'number') {
    numPrice = price;
  } else if (typeof price === 'string') {
    const cleaned = price.replace(/[^0-9.]/g, '');
    const parsed = parseFloat(cleaned);
    if (!isNaN(parsed)) {
      numPrice = parsed;
    }
  }

  // Find matching tier
  for (const tier of tiers) {
    const minMatch = numPrice >= tier.min;
    let maxMatch = true;
    if (tier.max !== undefined && tier.max !== null) {
      if (tier.min === 0) {
        // e.g. < $20
        maxMatch = numPrice < tier.max;
      } else {
        maxMatch = numPrice <= tier.max;
      }
    }
    if (minMatch && maxMatch) {
      return tier.label;
    }
  }

  // Fallback to closest tier or mid-tier
  return tiers[1]?.label || 'Mid-Tier Gifts ($20 - $40)';
}

/**
 * Derives physical product type for custom_label_4.
 */
export function deriveProductTypeLabel(
  item: ProductItem,
  candidate?: string
): string {
  if (candidate && !isPriceLikeString(candidate) && candidate.trim()) {
    // If candidate is a valid product type, preserve it
    const trimmed = candidate.trim();
    if (!trimmed.toLowerCase().includes('history buffs') && !trimmed.toLowerCase().includes('gift')) {
      return trimmed;
    }
  }

  const title = (item.merchantData?.title || item.evidence?.pageTitle || '').toLowerCase();
  const rawDesc = (item.merchantData?.description || item.evidence?.rawDescription || '').toLowerCase();
  const existingPt = (item.merchantData?.product_type || '').toLowerCase();
  const combined = `${title} ${rawDesc} ${existingPt}`;

  if (combined.includes('whiskey glass') || combined.includes('rocks glass')) return 'Whiskey Glass';
  if (combined.includes('beer glass') || combined.includes('can glass') || combined.includes('beer mug')) return 'Beer Glass';
  if (combined.includes('water bottle') || combined.includes('insulated bottle')) return 'Water Bottle';
  if (combined.includes('mug') || combined.includes('coffee mug')) return 'Mug';
  if (combined.includes('poster') || combined.includes('blueprint') || combined.includes('wall art') || combined.includes('art print')) return 'Poster';
  if (combined.includes('desk mat') || combined.includes('desk pad') || combined.includes('mouse pad')) return 'Desk Mat';
  if (combined.includes('notebook') || combined.includes('journal')) return 'Journal';
  if (combined.includes('cap') || combined.includes('hat')) return 'Caps & Hats';
  if (combined.includes('tote') || combined.includes('tote bag')) return 'Tote Bag';
  if (combined.includes('puzzle')) return 'Puzzle';
  if (combined.includes('hoodie') || combined.includes('sweatshirt')) return 'Hoodie';
  if (combined.includes('t-shirt') || combined.includes('tee') || (combined.includes('shirt') && !combined.includes('water bottle'))) return 'T-Shirt';

  // Check if strategy productCategory is set
  if (item.strategy?.productCategory && !isPriceLikeString(item.strategy.productCategory)) {
    return item.strategy.productCategory;
  }

  // Established default broader grouping
  return 'Apparel / Drinkware / Decor';
}

/**
 * Derives theme / collection for custom_label_3.
 */
export function deriveThemeLabel(
  item: ProductItem,
  config?: StrategyConfig,
  candidate?: string
): string {
  if (candidate && !isPriceLikeString(candidate) && !isProductTypeLikeString(candidate) && candidate.trim()) {
    return candidate.trim();
  }

  if (item.giftIntelligence?.theme && !isPriceLikeString(item.giftIntelligence.theme) && !isProductTypeLikeString(item.giftIntelligence.theme)) {
    return item.giftIntelligence.theme;
  }

  if (item.strategy?.dominantTheme && !isPriceLikeString(item.strategy.dominantTheme) && !isProductTypeLikeString(item.strategy.dominantTheme)) {
    return item.strategy.dominantTheme;
  }

  const title = (item.merchantData?.title || item.evidence?.pageTitle || '').toLowerCase();
  const desc = (item.merchantData?.description || item.evidence?.rawDescription || '').toLowerCase();
  const text = `${title} ${desc}`;

  // Domain matches
  if (text.includes('viking') || text.includes('norse') || text.includes('valhalla') || text.includes('thor') || text.includes('odin')) return 'Norse Mythology';
  if (text.includes('greek mythology') || text.includes('athena') || text.includes('zeus') || text.includes('poseidon') || text.includes('spartan')) return 'Greek Mythology';
  if (text.includes('ancient rome') || text.includes('roman') || text.includes('spqr') || text.includes('marcus aurelius') || text.includes('caesar') || text.includes('stoic')) return 'Ancient Rome';
  if (text.includes('civil war') || text.includes('gettysburg') || text.includes('1861') || text.includes('1863') || text.includes('1865')) return 'American Civil War';
  if (text.includes('wwii') || text.includes('world war ii') || text.includes('spitfire') || text.includes('warbird') || text.includes('d-day') || text.includes('b-17')) return 'World War II';
  if (text.includes('lincoln') || text.includes('gettysburg address')) return 'Abraham Lincoln';
  if (text.includes('american revolution') || text.includes('1776') || text.includes('founding fathers')) return 'American Revolution';
  if (text.includes('how i met your mother') || text.includes('himym') || text.includes('barney stinson') || text.includes('suit up')) return 'How I Met Your Mother';
  if (text.includes('filmmaker') || text.includes('screenwriter') || text.includes('clapperboard') || text.includes('cinema')) return 'Filmmaking & Cinema Arts';
  if (text.includes('jazz') || text.includes('miles davis') || text.includes('coltrane')) return 'Jazz Music';
  if (text.includes('classical music') || text.includes('beethoven') || text.includes('mozart') || text.includes('symphony')) return 'Classical Music';
  if (text.includes('science') || text.includes('physics') || text.includes('quantum') || text.includes('astronomy')) return 'Science & Physics';

  if (item.productSubgroup && item.productSubgroup !== 'General Gifts') {
    return item.productSubgroup;
  }

  // Check config themes
  if (config?.themes) {
    const matched = config.themes.find((t) =>
      t.keywords.some((kw) => text.includes(kw.toLowerCase())) ||
      text.includes(t.name.toLowerCase())
    );
    if (matched) return matched.name;
  }

  return 'History';
}

/**
 * Derives Gift Audience for custom_label_0.
 */
export function deriveGiftAudienceLabel(
  item: ProductItem,
  config?: StrategyConfig,
  candidate?: string
): string {
  if (candidate && !isPriceLikeString(candidate) && !isProductTypeLikeString(candidate) && candidate.trim()) {
    const c = candidate.trim();
    // Do not allow raw theme as audience if clearly a theme (unless theme-specific fans)
    if (!c.toLowerCase().endsWith('hoodie') && !c.toLowerCase().endsWith('t-shirt')) {
      return c;
    }
  }

  const targetAudiences = item.giftIntelligence?.targetAudience;
  if (Array.isArray(targetAudiences) && targetAudiences.length > 0) {
    const first = targetAudiences[0];
    if (first && !isPriceLikeString(first) && !isProductTypeLikeString(first)) {
      return first;
    }
  }

  const title = (item.merchantData?.title || item.evidence?.pageTitle || '').toLowerCase();
  const desc = (item.merchantData?.description || item.evidence?.rawDescription || '').toLowerCase();
  const theme = (item.giftIntelligence?.theme || item.strategy?.dominantTheme || '').toLowerCase();
  const text = `${title} ${desc} ${theme}`;

  if (text.includes('himym') || text.includes('how i met your mother')) return 'Sitcom & TV Fans';
  if (text.includes('filmmaker') || text.includes('director') || text.includes('screenwriter')) return 'Filmmakers & Video Creators';
  if (text.includes('science') || text.includes('physics') || text.includes('astronomy')) return 'Scientists & STEM Students';
  if (text.includes('teacher') || text.includes('professor')) return 'History & Science Teachers';
  if (text.includes('writer') || text.includes('author') || text.includes('novelist')) return 'Writers & Novelists';
  if (text.includes('police') || text.includes('law enforcement')) return 'Law Enforcement';
  if (text.includes('pilot') || text.includes('aviation')) return 'Aviation Enthusiasts';
  if (text.includes('greek mythology') || text.includes('mythology')) return 'History Buffs';
  if (text.includes('norse') || text.includes('viking')) return 'History Buffs';
  if (text.includes('music') || text.includes('jazz') || text.includes('composer')) return 'Music Lovers';

  if (config?.giftAudiences && config.giftAudiences.length > 0) {
    return config.giftAudiences[0].name;
  }

  return 'History Buffs';
}

/**
 * Derives seasonality for custom_label_2.
 */
export function deriveSeasonalityLabel(
  item: ProductItem,
  candidate?: string
): string {
  if (candidate && !isPriceLikeString(candidate) && !isProductTypeLikeString(candidate) && candidate.trim()) {
    const candLower = candidate.toLowerCase().trim();
    if (
      candLower.includes('year-round') ||
      candLower.includes('essential') ||
      candLower.includes('christmas') ||
      candLower.includes('holiday') ||
      candLower.includes('father') ||
      candLower.includes('mother') ||
      candLower.includes('graduation') ||
      candLower.includes('fall') ||
      candLower.includes('spring') ||
      candLower.includes('summer') ||
      candLower.includes('winter') ||
      candLower.includes('back to school')
    ) {
      return candidate.trim();
    }
  }

  // Check occasions
  const occasions = item.giftIntelligence?.occasions || [];
  if (occasions.some((o) => /christmas|holiday/i.test(o))) {
    // Only use holiday if product title or description explicitly mentions holiday/Christmas
    const text = `${item.merchantData?.title || ''} ${item.merchantData?.description || ''}`.toLowerCase();
    if (text.includes('christmas') || text.includes('holiday sweater') || text.includes('ugly sweater')) {
      return 'Christmas / Holidays';
    }
  }

  return 'Year-Round Essential';
}

/**
 * Allocates all 5 Google Merchant Center custom labels with strict semantic separation:
 * custom_label_0: Gift Audience
 * custom_label_1: Price Tier (derived from actual price)
 * custom_label_2: Seasonality
 * custom_label_3: Theme / Niche
 * custom_label_4: Product Type
 */
export function allocateCustomLabels(
  item: ProductItem,
  config: StrategyConfig,
  options?: {
    aiGenerated?: Partial<MerchantData>;
    strategy?: any;
    targetAudience?: string;
    theme?: string;
    productType?: string;
    seasonality?: string;
  }
): CustomLabelsAllocation {
  const ai = options?.aiGenerated || {};

  // 1. Label 1: Price Tier - ALWAYS derived from the actual product price
  const priceTier = derivePriceTier(item.merchantData?.price, config.priceTiers);

  // 2. Label 4: Product Type - Physical product type
  let productTypeCandidate = options?.productType || ai.custom_label_4;
  // If AI mistakenly placed product type in custom_label_1, recover it
  if (!productTypeCandidate || isPriceLikeString(productTypeCandidate)) {
    if (ai.custom_label_1 && isProductTypeLikeString(ai.custom_label_1)) {
      productTypeCandidate = ai.custom_label_1;
    } else if (ai.custom_label_3 && isProductTypeLikeString(ai.custom_label_3)) {
      productTypeCandidate = ai.custom_label_3;
    }
  }
  const productType = deriveProductTypeLabel(item, productTypeCandidate);

  // 3. Label 3: Theme / Niche - Actual subject or collection
  let themeCandidate = options?.theme || ai.custom_label_3;
  // If AI mistakenly placed theme in custom_label_0 (e.g. "World War II")
  if (!themeCandidate || isPriceLikeString(themeCandidate) || isProductTypeLikeString(themeCandidate)) {
    if (ai.custom_label_0 && !isPriceLikeString(ai.custom_label_0) && !isProductTypeLikeString(ai.custom_label_0)) {
      // Check if custom_label_0 is actually a theme
      const c0Lower = ai.custom_label_0.toLowerCase();
      if (c0Lower.includes('war') || c0Lower.includes('mythology') || c0Lower.includes('rome') || c0Lower.includes('lincoln')) {
        themeCandidate = ai.custom_label_0;
      }
    }
  }
  const theme = deriveThemeLabel(item, config, themeCandidate);

  // 4. Label 0: Gift Audience - Intended recipient or interest audience
  let audienceCandidate = options?.targetAudience || ai.custom_label_0;
  // If AI placed audience in custom_label_2 (e.g. "History Buffs")
  if (
    !audienceCandidate ||
    isPriceLikeString(audienceCandidate) ||
    isProductTypeLikeString(audienceCandidate) ||
    audienceCandidate === theme
  ) {
    if (ai.custom_label_2 && (ai.custom_label_2.toLowerCase().includes('buff') || ai.custom_label_2.toLowerCase().includes('enthusiast') || ai.custom_label_2.toLowerCase().includes('fans') || ai.custom_label_2.toLowerCase().includes('teachers'))) {
      audienceCandidate = ai.custom_label_2;
    } else if (ai.custom_label_4 && !isPriceLikeString(ai.custom_label_4) && !isProductTypeLikeString(ai.custom_label_4)) {
      audienceCandidate = ai.custom_label_4;
    }
  }
  const audience = deriveGiftAudienceLabel(item, config, audienceCandidate);

  // 5. Label 2: Seasonality - Commercial seasonality, default Year-Round Essential
  let seasonCandidate = options?.seasonality || ai.custom_label_2;
  // If custom_label_2 was populated with an audience or price, reset candidate
  if (seasonCandidate && (isPriceLikeString(seasonCandidate) || isProductTypeLikeString(seasonCandidate) || seasonCandidate.toLowerCase().includes('buff') || seasonCandidate.toLowerCase().includes('fan'))) {
    seasonCandidate = undefined;
  }
  const seasonality = deriveSeasonalityLabel(item, seasonCandidate);

  return {
    custom_label_0: audience,
    custom_label_1: priceTier,
    custom_label_2: seasonality,
    custom_label_3: theme,
    custom_label_4: productType,
  };
}

/**
 * Detects whether existing stored custom labels on a product are scrambled, misplaced, or missing.
 */
export function detectCustomLabelAnomalies(
  item: ProductItem,
  config: StrategyConfig = INITIAL_STRATEGY_CONFIG
): CustomLabelAnomalies {
  const issues: string[] = [];
  const md = item.merchantData || ({} as MerchantData);

  const l0 = (md.custom_label_0 || '').trim();
  const l1 = (md.custom_label_1 || '').trim();
  const l2 = (md.custom_label_2 || '').trim();
  const l3 = (md.custom_label_3 || '').trim();
  const l4 = (md.custom_label_4 || '').trim();

  const expectedPriceTier = derivePriceTier(md.price, config.priceTiers);

  // Check 1: Is custom_label_1 missing or NOT a price tier?
  if (!l1) {
    issues.push('Custom Label 1 (Price Tier) is empty.');
  } else if (isProductTypeLikeString(l1)) {
    issues.push(`Custom Label 1 contains physical product type ("${l1}") instead of a price tier.`);
  } else if (!isPriceLikeString(l1) && l1 !== expectedPriceTier) {
    issues.push(`Custom Label 1 ("${l1}") does not match the product price tier.`);
  }

  // Check 2: Is price tier in custom_label_2, 3, or 4?
  if (isPriceLikeString(l2)) {
    issues.push(`Custom Label 2 (Seasonality) contains price data ("${l2}").`);
  }
  if (isPriceLikeString(l3)) {
    issues.push(`Custom Label 3 (Theme) contains price data ("${l3}").`);
  }
  if (isPriceLikeString(l4)) {
    issues.push(`Custom Label 4 (Product Type) contains price data ("${l4}").`);
  }

  // Check 3: Is audience in seasonality?
  if (l2 && (l2.toLowerCase().includes('buff') || l2.toLowerCase().includes('fan') || l2.toLowerCase().includes('lover'))) {
    issues.push(`Custom Label 2 contains gift audience ("${l2}") instead of seasonality.`);
  }

  // Check 4: Is product type in theme?
  if (l3 && isProductTypeLikeString(l3) && !l3.toLowerCase().includes('history') && !l3.toLowerCase().includes('war')) {
    issues.push(`Custom Label 3 contains product type ("${l3}") instead of a theme.`);
  }

  // Check 5: Is product type empty?
  if (!l4) {
    issues.push('Custom Label 4 (Product Type) is empty.');
  }

  const recommendedLabels = allocateCustomLabels(item, config);

  return {
    hasMisallocatedLabels: issues.length > 0,
    issues,
    recommendedLabels,
  };
}

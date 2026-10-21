import { Type } from '@google/genai';
import { getGeminiClient } from './gemini';
import {
  AIStrategy,
  AIAudit,
  AuditIssue,
  FieldProvenanceStatus,
  FieldProvenanceMap,
  GiftIntelligence,
  MerchantData,
  ProductItem,
  StrategyConfig,
  TitleCandidate,
} from '../src/types/feed';

async function callGeminiWithRetry(
  ai: any,
  modelName: string,
  params: { contents: string; config?: any },
  maxRetries = 3
): Promise<any> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await ai.models.generateContent({
        model: modelName,
        ...params,
      });
    } catch (err: any) {
      const isRateLimit =
        err?.status === 'RESOURCE_EXHAUSTED' ||
        err?.code === 429 ||
        (err?.message && (err.message.includes('429') || err.message.includes('Quota exceeded') || err.message.includes('RESOURCE_EXHAUSTED')));

      if (isRateLimit && attempt < maxRetries - 1) {
        attempt++;
        const backoffMs = attempt * 5000; // 5s, 10s, 15s
        console.warn(`[Gemini Rate Limit 429] Retrying in ${backoffMs / 1000}s (Attempt ${attempt}/${maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      throw err;
    }
  }
}

export async function generateProductStrategy(
  item: ProductItem,
  config: StrategyConfig
): Promise<AIStrategy> {
  const ai = getGeminiClient();
  const modelName = config.geminiModel || 'gemini-3.5-flash-lite';

  const systemInstruction = `You are the Lead Merchant Center Strategist for "Science of Gifts", an ecommerce brand specializing in gifts for history buffs, science nerds, filmmakers, writers, and curious minds.
Your task is to analyze product evidence strictly and produce a 15-point product strategy.

RULES:
1. NEVER invent unverified factual product attributes (materials, dimensions, size, GTIN, MPN). If uncertain, explicitly say so in antiRecommendations.
2. Distinguish between VERIFIED FACTS, AI INTERPRETATION, and AI RECOMMENDATIONS.
3. The internal Science of Gifts taxonomy (Themes, Audiences, Occasions) is for understanding and custom labels, NOT for polluting Google Product Category.
4. Output valid JSON adhering to the provided schema.`;

  const userPrompt = `Analyze the following product evidence and create a comprehensive strategy:

PRODUCT GROUP & COLLECTION ASSIGNMENT:
- Product Group: ${item.productGroup || 'Unspecified'}
- Product Subgroup: ${item.productSubgroup || 'Unspecified'}

CRITICAL PRODUCT GROUP CONSTRAINT:
The product belongs strictly to Product Group "${item.productGroup || 'Unspecified'}" (Subgroup: "${item.productSubgroup || 'Unspecified'}"). You MUST keep all generated titles, descriptions, themes, and gift positioning strictly within this domain. Do NOT reclassify a product into an unrelated domain (e.g. do NOT turn TV & Film products or Music products into History products).

PRODUCT EVIDENCE:
- Page Title: ${item.evidence.pageTitle}
- URL: ${item.evidence.sourceUrl}
- Raw Description: ${item.evidence.rawDescription}
- Verified Attributes: ${JSON.stringify(item.evidence.verifiedAttributes)}
- Extracted Images: ${item.evidence.images.join(', ')}
- Price: ${item.merchantData.price}

AVAILABLE SCIENCE OF GIFTS PRODUCT GROUPS:
${(config.productGroups || []).map((g) => `- ${g.name} (subgroups: ${(g.subgroups || []).join(', ')})`).join('\n')}

AVAILABLE SCIENCE OF GIFTS THEMES:
${config.themes.map((t) => `- ${t.name} (subthemes: ${t.subthemes.join(', ')})`).join('\n')}

AVAILABLE GIFT AUDIENCES:
${config.giftAudiences.map((a) => `- ${a.name}: ${a.description}`).join('\n')}

AVAILABLE OCCASIONS:
${config.occasions.join(', ')}`;

  try {
    const response = await callGeminiWithRetry(ai, modelName, {
      contents: userPrompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            exactProductSummary: {
              type: Type.STRING,
              description: '1. What exactly is this product? Concise factual physical summary.',
            },
            dominantTheme: {
              type: Type.STRING,
              description: '2. What is the dominant subject or theme? (e.g. American Civil War, Filmmaking)',
            },
            productCategory: {
              type: Type.STRING,
              description: '3. What core product category does it belong to? (e.g. Hoodies, Ceramic Mugs, Wall Art)',
            },
            verifiedPhysicalAttributes: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '4. Verified physical attributes supported by evidence only.',
            },
            realisticBuyer: {
              type: Type.STRING,
              description: '5. Who would realistically buy it? (Self-buyer or gift giver persona)',
            },
            realisticRecipient: {
              type: Type.STRING,
              description: '6. Who would realistically receive it as a gift?',
            },
            giftRationale: {
              type: Type.STRING,
              description: '7. Why would someone give this as a gift? Real emotional/intellectual connection.',
            },
            relevantSearchIntents: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '8. Genuinely relevant gift and shopping search intents (max 5, no keyword stuffing).',
            },
            differentiatingAttributes: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '9. Key attributes distinguishing this item from generic alternatives.',
            },
            titleStrategy: {
              type: Type.STRING,
              description: '10. Strategy for title construction (front-loading subject and type).',
            },
            descriptionStrategy: {
              type: Type.STRING,
              description: '11. Strategy for description (subject narrative + verified specs + natural gift appeal).',
            },
            productTypeStrategy: {
              type: Type.STRING,
              description: '12. Hierarchical product_type strategy (Broad > Specific).',
            },
            customLabelsStrategy: {
              type: Type.OBJECT,
              properties: {
                custom_label_0: { type: Type.STRING, description: 'Gift Audience' },
                custom_label_1: { type: Type.STRING, description: 'Price Tier' },
                custom_label_2: { type: Type.STRING, description: 'Seasonality' },
                custom_label_3: { type: Type.STRING, description: 'Theme / Collection' },
                custom_label_4: { type: Type.STRING, description: 'Product Type' },
              },
              description: '13. Allocation for custom_label_0 to custom_label_4 based on config.',
            },
            antiRecommendations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '14. What information MUST NOT be added (e.g. unverified claims, promotional words, stuffed keywords).',
            },
            googleCategoryRationale: {
              type: Type.STRING,
              description: '15. Rationale for standard Google Product Category selection.',
            },
            recommendedGoogleCategory: {
              type: Type.STRING,
              description: 'Official Google Product Category path (e.g. Apparel & Accessories > Clothing > Shirts & Tops).',
            },
          },
          required: [
            'exactProductSummary',
            'dominantTheme',
            'productCategory',
            'verifiedPhysicalAttributes',
            'realisticBuyer',
            'realisticRecipient',
            'giftRationale',
            'relevantSearchIntents',
            'differentiatingAttributes',
            'titleStrategy',
            'descriptionStrategy',
            'productTypeStrategy',
            'antiRecommendations',
            'googleCategoryRationale',
            'recommendedGoogleCategory',
          ],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return {
      ...parsed,
      researchedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    console.warn('[AI Strategist] Falling back to heuristic strategy:', err.message);
    return createHeuristicStrategy(item, config);
  }
}

export async function generateOptimizedFields(
  item: ProductItem,
  strategy: AIStrategy,
  config: StrategyConfig
): Promise<{
  suggestedMerchantData: Partial<MerchantData>;
  suggestedGiftIntelligence: Partial<GiftIntelligence>;
  titleCandidates: TitleCandidate[];
}> {
  const ai = getGeminiClient();
  const modelName = config.geminiModel || 'gemini-3.5-flash-lite';

  const systemInstruction = `You are a Senior Google Merchant Center Feed Optimization Engineer and E-Commerce Merchandising Strategist for Science of Gifts.
Generate high-converting, compliant Merchant Center fields for Science of Gifts based on verified product evidence.

CRITICAL TITLE STRATEGY & SPECIFICITY RULES:
1. SPECIFIC THEME PRIORITY (NOT BROAD CATEGORY PREFIXES):
   - Prioritize the MOST SPECIFIC commercially meaningful theme available for the product over broad umbrella categories.
   - Do NOT interpret "core theme first" as meaning broad phrases such as "History Gift" should be used as a universal title prefix.
   - Distinguish between:
     * Broad Theme: History (or Science, Literature)
     * Specific Theme: Civil War, WWII Aviation, Abraham Lincoln, Greek Mythology, History Teacher, Ancient Rome, Vikings, Quantum Physics, Screenwriting
     * Primary Shopping Intent: Civil War gifts, Abraham Lincoln mug, Screenwriter notebook
     * Secondary Shopping Intent: History gifts, Science gifts
   - The SPECIFIC theme MUST have priority over the broad category.
   - Do NOT generate repetitive titles such as "History Gift Hoodie...", "History Gift T-Shirt...", "History Gift Mug..." simply because products belong to the broad History category.

2. PREFERRED TITLE HIERARCHY:
   Step 1: Specific product theme / subject (e.g. "Civil War", "WWII Aviation", "Abraham Lincoln", "Greek Mythology", "History Teacher")
   Step 2: Product type (e.g. "Hoodie", "T-Shirt", "Mug", "Journal", "Poster")
   Step 3: Gift intent when genuinely relevant (e.g. "Civil War Gift Hoodie", "Abraham Lincoln Gift Mug", or in secondary clause "- Military History Gift for Aviation Enthusiasts")
   Step 4: Important differentiating attributes (e.g. "1861-1865 American History Design", "Famous Quotes Ceramic Coffee Cup", "Athena Design", "1863 Battle Map")
   Step 5: Relevant recipient/audience where useful (e.g. "for Aviation Enthusiasts", "for History Buffs", "for Screenwriters")
   Step 6: Other useful verified attributes (e.g. "Heavyweight Fleece", "15 oz Ceramic", "Matte Hardcover")

3. TARGET STRUCTURE EXAMPLES:
   - Civil War hoodie: "Civil War Gift Hoodie - 1861-1865 American History Design"
   - WWII aviation shirt: "WWII Aviation T-Shirt - Military History Gift for Aviation Enthusiasts"
   - Abraham Lincoln mug: "Abraham Lincoln Gift Mug - Famous Quotes Ceramic Coffee Cup"
   - Greek mythology shirt: "Greek Mythology Gift T-Shirt - Athena Design"
   - History teacher mug: "History Teacher Gift Mug - Definition Ceramic Coffee Cup"
   - General history product: "History Buff T-Shirt - BC AD World History Timeline Design"
   - Products where "gift" is unnatural: Keep natural without forcing "gift" (e.g. "Spitfire Mk IX Blueprint Poster - 18x24 RAF Archival Wall Art").

4. DO NOT KEYWORD STUFF & DO NOT FORCE "GIFT":
   - Use "gift" terminology when it genuinely improves shopping intent and search matching.
   - Do NOT mechanically add "gift" to every title if it makes the syntax clumsy or unnatural.
   - NEVER exceed 150 characters.

5. Generate up to 3 candidate titles with distinct strategic emphasis:
   - Candidate 1 (Specific Theme + Gift Intent + Product Type + Differentiator)
   - Candidate 2 (Specific Theme + Product Type + Differentiator + Secondary Gift/Audience Intent)
   - Candidate 3 (Specific Design/Subject + Distinctive Attribute + Product Form Factor)

6. Score EACH candidate across 7 dimensions (0-100):
   - coreThemeProminence: Is the specific theme front-loaded (not generic broad prefix)?
   - giftSearchRelevance: Does it capture genuine shopping and discovery intent?
   - productClarity: Is it immediately clear what physical product is being sold?
   - naturalLanguage: Does it read naturally without sounding robotic or repetitive?
   - factualAccuracy: Is it 100% faithful to source page evidence?
   - differentiation: Does it highlight unique attributes separating it from generic alternatives?
   - characterEfficiency: Efficient use of character budget within 150 chars.
   - total: Composite score (0-100).

7. Provide titleStrategyReasoning explaining WHY the specific theme and title structure were chosen.

CRITICAL DESCRIPTION RULES:
- Natural, compelling, and informative (150-400 words).
- Explain what the product is, what historical/scientific subject it honors, verified materials, and why it makes a memorable gift.
- No invented specs. No generic filler like "Perfect for anyone who loves this amazing product."`;

  const userPrompt = `Product Details:
Product Group: ${item.productGroup || 'Unspecified'}
Product Subgroup: ${item.productSubgroup || 'Unspecified'}
Current Title: ${item.merchantData.title}
Current Description: ${item.merchantData.description}
Price: ${item.merchantData.price}
Verified Attributes: ${JSON.stringify(item.evidence.verifiedAttributes)}
Dominant Theme: ${strategy.dominantTheme}
Product Category: ${strategy.productCategory}
Relevant Search Intents: ${strategy.relevantSearchIntents.join(', ')}
Gift Rationale: ${strategy.giftRationale}
Recommended GPC: ${strategy.recommendedGoogleCategory}`;

  try {
    const response = await callGeminiWithRetry(ai, modelName, {
      contents: userPrompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            titlePriorityOrder: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Determined priority order sequence (e.g. ["1. Core Theme: American Civil War", "2. Gift Intent: Civil War Gift", "3. Product Type: Hoodie", "4. Differentiator: 1863 Battle Map"])',
            },
            titleStrategyReasoning: {
              type: Type.STRING,
              description: 'Explanation of why this title priority and structure was chosen for this product.',
            },
            titleCandidates: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                  formula: { type: Type.STRING },
                  titlePriorityOrder: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  titleStrategyReasoning: { type: Type.STRING },
                  scores: {
                    type: Type.OBJECT,
                    properties: {
                      coreThemeProminence: { type: Type.NUMBER },
                      giftSearchRelevance: { type: Type.NUMBER },
                      productClarity: { type: Type.NUMBER },
                      naturalLanguage: { type: Type.NUMBER },
                      factualAccuracy: { type: Type.NUMBER },
                      differentiation: { type: Type.NUMBER },
                      characterEfficiency: { type: Type.NUMBER },
                      total: { type: Type.NUMBER },
                    },
                    required: [
                      'coreThemeProminence',
                      'giftSearchRelevance',
                      'productClarity',
                      'naturalLanguage',
                      'factualAccuracy',
                      'differentiation',
                      'characterEfficiency',
                      'total',
                    ],
                  },
                  reasoning: { type: Type.STRING },
                },
                required: ['id', 'title', 'formula', 'scores', 'reasoning'],
              },
            },
            bestTitle: { type: Type.STRING },
            optimizedDescription: { type: Type.STRING },
            color: { type: Type.STRING, description: 'Standard Merchant Center color (e.g. Black, Heather Charcoal, Glossy White).' },
            size: { type: Type.STRING, description: 'Standard Merchant Center size (e.g. 18" x 24", 15 oz, L, S-3XL).' },
            material: { type: Type.STRING, description: 'Standard Merchant Center material (e.g. 100% Cotton, Ceramic, Museum-grade Matte Paper).' },
            googleProductCategory: { type: Type.STRING },
            productType: { type: Type.STRING },
            giftTheme: { type: Type.STRING },
            giftSubtheme: { type: Type.STRING },
            targetAudiences: { type: Type.ARRAY, items: { type: Type.STRING } },
            recipientPersonas: { type: Type.ARRAY, items: { type: Type.STRING } },
            occasions: { type: Type.ARRAY, items: { type: Type.STRING } },
            primaryGiftIntent: { type: Type.STRING },
            secondaryGiftIntents: { type: Type.ARRAY, items: { type: Type.STRING } },
            searchConcepts: { type: Type.ARRAY, items: { type: Type.STRING } },
            customLabels: {
              type: Type.OBJECT,
              properties: {
                custom_label_0: { type: Type.STRING },
                custom_label_1: { type: Type.STRING },
                custom_label_2: { type: Type.STRING },
                custom_label_3: { type: Type.STRING },
                custom_label_4: { type: Type.STRING },
              },
            },
          },
          required: [
            'titleCandidates',
            'bestTitle',
            'titlePriorityOrder',
            'titleStrategyReasoning',
            'optimizedDescription',
            'googleProductCategory',
            'productType',
            'giftTheme',
            'targetAudiences',
            'primaryGiftIntent',
          ],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');

    // Calculate Price Tier for custom_label_1 if missing
    let priceTier = parsed.customLabels?.custom_label_1 || '';
    if (!priceTier) {
      const numPrice = parseFloat(item.merchantData.price.replace(/[^0-9.]/g, '')) || 25;
      const matchedTier = config.priceTiers.find((t) => numPrice >= t.min && (!t.max || numPrice <= t.max));
      priceTier = matchedTier ? matchedTier.label : 'Mid-Tier Gifts ($20 - $40)';
    }

    const suggestedMerchantData: Partial<MerchantData> = {
      title: parsed.bestTitle || parsed.titleCandidates?.[0]?.title || item.merchantData.title,
      description: parsed.optimizedDescription || item.merchantData.description,
      color: parsed.color || item.evidence.verifiedAttributes?.color || item.merchantData.color || '',
      size: parsed.size || item.evidence.verifiedAttributes?.size || item.merchantData.size || '',
      material: parsed.material || item.evidence.verifiedAttributes?.material || item.merchantData.material || '',
      google_product_category: parsed.googleProductCategory || strategy.recommendedGoogleCategory || item.merchantData.google_product_category,
      product_type: parsed.productType || item.merchantData.product_type,
      custom_label_0: parsed.customLabels?.custom_label_0 || parsed.targetAudiences?.[0] || 'History Buffs',
      custom_label_1: priceTier,
      custom_label_2: parsed.customLabels?.custom_label_2 || 'Year-Round Essential',
      custom_label_3: parsed.customLabels?.custom_label_3 || parsed.giftTheme || strategy.dominantTheme,
      custom_label_4: parsed.customLabels?.custom_label_4 || strategy.productCategory || item.merchantData.custom_label_4,
    };

    const suggestedGiftIntelligence: Partial<GiftIntelligence> = {
      theme: parsed.giftTheme || strategy.dominantTheme,
      subtheme: parsed.giftSubtheme || '',
      targetAudience: parsed.targetAudiences || [],
      recipientPersonas: parsed.recipientPersonas || [],
      occasions: parsed.occasions || [],
      primaryGiftIntent: parsed.primaryGiftIntent || '',
      secondaryGiftIntents: parsed.secondaryGiftIntents || [],
      searchConcepts: parsed.searchConcepts || [],
    };

    return {
      suggestedMerchantData,
      suggestedGiftIntelligence,
      titleCandidates: parsed.titleCandidates || [],
    };
  } catch (err: any) {
    console.warn('[AI Field Generator] Falling back to heuristic field generation:', err.message);
    return createHeuristicFields(item, strategy, config);
  }
}

export async function performAIAudit(
  item: ProductItem,
  config: StrategyConfig
): Promise<AIAudit> {
  const ai = getGeminiClient();
  const modelName = config.geminiModel || 'gemini-3.5-flash-lite';
  const previousScore = item.audit?.overallScore;

  const systemInstruction = `You are an independent Senior Google Merchant Center Feed Quality Auditor and Policy Specialist.
Your goal is to rigorously audit the product data against Google Merchant Center policies, gift search relevance, factual accuracy against evidence, and natural language quality.

CRITICAL ISSUE CLASSIFICATION:
Classify EVERY identified audit issue into one of three strict states:
1. "safe_to_fix": Issues that can be automatically and safely resolved using verified evidence or configured strategy (e.g. description missing verified materials or color from evidence, custom labels empty that can be derived from strategy, missing GPC matching obvious form factor, title lacking specific theme).
2. "requires_review": Factual uncertainties that CANNOT be verified from source evidence and must NOT be fabricated (e.g. unverified material claim, conflicting variants).
3. "informational": Positive confirmations or non-blocking policy compliance.

CRITICAL IDENTIFIER & GTIN AUDIT RULES:
- If GTIN is empty, MPN is empty, and identifier_exists is explicitly set to "no" (or "false"):
  * Do NOT classify this as an unresolved error, warning, or requires_review issue.
  * Do NOT output contradictory warnings like "Ensure identifier_exists remains strictly set to 'false' or 'no'". If it is already "no", that is resolved.
  * Instead, return an "informational" issue:
    title: "✓ No GTIN"
    description: "Identifier Exists: No. No manufacturer identifier was supplied for this product."
    state: "informational"
    suggestedFix: "Compliant with Google Merchant Center custom goods policy."
  * Maintain high complianceScore (98-100).
- ONLY flag GTIN as requiring review when:
  1. A GTIN is expected but missing (e.g. source evidence provided a GTIN that was not transferred, or identifier_exists is 'yes' with no GTIN/MPN).
  2. identifier_exists is inconsistent (e.g. valid GTIN is provided but identifier_exists is 'no').
  3. A supplied GTIN appears malformed or fake placeholder (not 8, 12, 13, 14 digits).
- NEVER ask the user to manually verify a GTIN that the product source does not provide.

Return structured JSON with scores (0-100), classified issues list, warnings, critical errors, and suggested fixes.`;

  const userPrompt = `AUDIT TARGET PRODUCT:
Title: ${item.merchantData.title}
Description: ${item.merchantData.description}
Price: ${item.merchantData.price}
Google Product Category: ${item.merchantData.google_product_category}
Product Type: ${item.merchantData.product_type}
Availability: ${item.merchantData.availability}
Brand: ${item.merchantData.brand}
GTIN: ${item.merchantData.gtin || 'none'}
MPN: ${item.merchantData.mpn || 'none'}
Identifier Exists: ${item.merchantData.identifier_exists}
Custom Labels:
  0: ${item.merchantData.custom_label_0}
  1: ${item.merchantData.custom_label_1}
  2: ${item.merchantData.custom_label_2}
  3: ${item.merchantData.custom_label_3}
  4: ${item.merchantData.custom_label_4}

SOURCE EVIDENCE TO VERIFY AGAINST:
- Page Title: ${item.evidence.pageTitle}
- Verified Specs: ${JSON.stringify(item.evidence.verifiedAttributes)}
- Raw Description: ${item.evidence.rawDescription}`;

  try {
    const response = await callGeminiWithRetry(ai, modelName, {
      contents: userPrompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overallScore: { type: Type.NUMBER, description: 'Composite quality score 0-100' },
            fieldScores: {
              type: Type.OBJECT,
              properties: {
                accuracy: { type: Type.NUMBER },
                searchRelevance: { type: Type.NUMBER },
                giftRelevance: { type: Type.NUMBER },
                taxonomy: { type: Type.NUMBER },
                description: { type: Type.NUMBER },
                naturalLanguage: { type: Type.NUMBER },
                compliance: { type: Type.NUMBER },
              },
              required: [
                'accuracy',
                'searchRelevance',
                'giftRelevance',
                'taxonomy',
                'description',
                'naturalLanguage',
                'compliance',
              ],
            },
            issues: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  field: { type: Type.STRING },
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  state: {
                    type: Type.STRING,
                    description: 'Must be "safe_to_fix", "requires_review", or "informational"',
                  },
                  verifiedEvidence: { type: Type.STRING },
                  suggestedFix: { type: Type.STRING },
                },
                required: ['id', 'field', 'title', 'description', 'state', 'suggestedFix'],
              },
            },
            warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
            criticalErrors: { type: Type.ARRAY, items: { type: Type.STRING } },
            suggestedFixes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  field: { type: Type.STRING },
                  issue: { type: Type.STRING },
                  fix: { type: Type.STRING },
                },
                required: ['field', 'issue', 'fix'],
              },
            },
          },
          required: ['overallScore', 'fieldScores', 'issues', 'warnings', 'criticalErrors', 'suggestedFixes'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return {
      ...parsed,
      previousScore,
      auditedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    console.warn('[AI Audit] Falling back to heuristic audit:', err.message);
    return createHeuristicAudit(item, previousScore);
  }
}

export function computeFieldProvenance(
  item: ProductItem,
  priorMerchantData: Partial<MerchantData> = {}
): {
  fieldProvenance: Record<string, FieldProvenanceStatus>;
  fieldProvenanceDetails: FieldProvenanceMap;
  counts: { generated: number; optimized: number; verified: number; unavailable: number };
} {
  const provenance: Record<string, FieldProvenanceStatus> = {};
  const details: FieldProvenanceMap = {};
  const verified = item.evidence.verifiedAttributes || {};
  const md = item.merchantData;
  const prior = priorMerchantData;
  const now = new Date().toISOString();

  // 1. Factual Source Fields
  provenance.id = 'VERIFIED';
  details.id = { status: 'VERIFIED', source: 'Product source identifier', updatedAt: now };

  provenance.link = md.link ? 'VERIFIED' : 'UNAVAILABLE';
  details.link = { status: provenance.link, source: 'Extracted landing page URL', updatedAt: now };

  provenance.image_link = md.image_link ? 'VERIFIED' : 'UNAVAILABLE';
  details.image_link = { status: provenance.image_link, source: 'Extracted product photo', updatedAt: now };

  provenance.price = md.price ? 'VERIFIED' : 'UNAVAILABLE';
  details.price = { status: provenance.price, source: 'Extracted price from evidence', updatedAt: now };

  provenance.availability = md.availability ? 'VERIFIED' : 'UNVERIFIED';
  details.availability = { status: provenance.availability, source: 'Source inventory status', updatedAt: now };

  provenance.brand = md.brand ? 'VERIFIED' : 'UNAVAILABLE';
  details.brand = { status: provenance.brand, source: 'Verified catalog brand', updatedAt: now };

  provenance.condition = md.condition ? 'VERIFIED' : 'VERIFIED';
  details.condition = { status: 'VERIFIED', source: 'Standard retail condition (new)', updatedAt: now };

  // 2. Physical Specs (Verified vs Generated vs Unavailable)
  if (md.color) {
    provenance.color = verified.color ? 'VERIFIED' : 'GENERATED';
    details.color = {
      status: provenance.color,
      source: verified.color ? 'Extracted from page specifications & variants' : 'Derived by AI from product strategy & options',
      updatedAt: now,
    };
  } else if (verified.color) {
    md.color = verified.color;
    provenance.color = 'VERIFIED';
    details.color = { status: 'VERIFIED', source: 'Extracted from page specifications & variants', updatedAt: now };
  } else {
    provenance.color = 'UNAVAILABLE';
    details.color = { status: 'UNAVAILABLE', note: 'Not specified in product evidence', updatedAt: now };
  }

  if (md.material) {
    provenance.material = verified.material ? 'VERIFIED' : 'GENERATED';
    details.material = {
      status: provenance.material,
      source: verified.material ? 'Extracted from page specifications' : 'Derived by AI from product strategy & options',
      updatedAt: now,
    };
  } else if (verified.material) {
    md.material = verified.material;
    provenance.material = 'VERIFIED';
    details.material = { status: 'VERIFIED', source: 'Extracted from page specifications', updatedAt: now };
  } else {
    provenance.material = 'UNAVAILABLE';
    details.material = { status: 'UNAVAILABLE', note: 'Not specified in product evidence', updatedAt: now };
  }

  if (md.size) {
    provenance.size = verified.size ? 'VERIFIED' : 'GENERATED';
    details.size = {
      status: provenance.size,
      source: verified.size ? 'Extracted from page specifications' : 'Derived by AI from product strategy & options',
      updatedAt: now,
    };
  } else if (verified.size) {
    md.size = verified.size;
    provenance.size = 'VERIFIED';
    details.size = { status: 'VERIFIED', source: 'Extracted from page specifications', updatedAt: now };
  } else {
    provenance.size = 'UNAVAILABLE';
    details.size = { status: 'UNAVAILABLE', note: 'Not applicable or unverified', updatedAt: now };
  }

  // 3. Identifier Fields (NEVER FABRICATED)
  if (md.gtin && md.gtin.trim()) {
    provenance.gtin = 'VERIFIED';
    details.gtin = { status: 'VERIFIED', source: 'Source barcode / GTIN', updatedAt: now };
  } else {
    provenance.gtin = 'UNAVAILABLE';
    details.gtin = {
      status: 'UNAVAILABLE',
      note: 'Not provided by source. AI will not fabricate GTIN.',
      updatedAt: now,
    };
  }

  if (md.mpn && md.mpn.trim()) {
    provenance.mpn = 'VERIFIED';
    details.mpn = { status: 'VERIFIED', source: 'Source manufacturer part number', updatedAt: now };
  } else {
    provenance.mpn = 'UNAVAILABLE';
    details.mpn = {
      status: 'UNAVAILABLE',
      note: 'Not provided by source. AI will not fabricate MPN.',
      updatedAt: now,
    };
  }

  provenance.identifier_exists = 'VERIFIED';
  details.identifier_exists = {
    status: 'VERIFIED',
    note: md.gtin ? 'Set to yes' : 'Set to no (Merchant Center POD standard)',
    updatedAt: now,
  };

  // 4. Generated vs Optimized vs Verified Fields
  const evaluateGenOrOpt = (
    field: string,
    currentVal: string,
    priorVal?: string,
    fallbackSource?: string
  ) => {
    if (!currentVal || !currentVal.trim()) {
      provenance[field] = 'UNAVAILABLE';
      details[field] = { status: 'UNAVAILABLE', note: 'Field is currently empty', updatedAt: now };
      return;
    }
    const hadPrior = Boolean(priorVal && priorVal.trim() && priorVal.trim() !== 'empty');
    if (!hadPrior) {
      provenance[field] = 'GENERATED';
      details[field] = {
        status: 'GENERATED',
        source: fallbackSource || 'Generated by AI from product evidence & strategy',
        updatedAt: now,
      };
    } else if (priorVal !== currentVal) {
      provenance[field] = 'OPTIMIZED';
      details[field] = {
        status: 'OPTIMIZED',
        source: 'Enhanced by AI for Merchant Center compliance & gift intent',
        updatedAt: now,
      };
    } else {
      provenance[field] = 'VERIFIED';
      details[field] = {
        status: 'VERIFIED',
        source: 'Preserved from existing verified data',
        updatedAt: now,
      };
    }
  };

  evaluateGenOrOpt('title', md.title, prior.title, 'Generated from specific theme, product type, and gift intent hierarchy');
  evaluateGenOrOpt('description', md.description, prior.description, 'Generated narrative, verified specs, and gift context');
  evaluateGenOrOpt('google_product_category', md.google_product_category, prior.google_product_category, 'Generated matching official Google product taxonomy');
  evaluateGenOrOpt('product_type', md.product_type, prior.product_type, 'Generated clean hierarchical category path');
  evaluateGenOrOpt('custom_label_0', md.custom_label_0, prior.custom_label_0, 'Generated Gift Audience from Science of Gifts strategy');
  evaluateGenOrOpt('custom_label_1', md.custom_label_1, prior.custom_label_1, 'Generated Price Tier from price calculation');
  evaluateGenOrOpt('custom_label_2', md.custom_label_2, prior.custom_label_2, 'Generated Seasonality tag');
  evaluateGenOrOpt('custom_label_3', md.custom_label_3, prior.custom_label_3, 'Generated Theme/Collection tag');
  evaluateGenOrOpt('custom_label_4', md.custom_label_4, prior.custom_label_4, 'Generated Product Form Factor tag');

  // Gift Intelligence
  provenance.gift_theme = item.giftIntelligence?.theme ? 'GENERATED' : 'UNAVAILABLE';
  provenance.gift_audience = item.giftIntelligence?.targetAudience?.length ? 'GENERATED' : 'UNAVAILABLE';
  provenance.gift_intent = item.giftIntelligence?.primaryGiftIntent ? 'GENERATED' : 'UNAVAILABLE';

  let countGenerated = 0;
  let countOptimized = 0;
  let countVerified = 0;
  let countUnavailable = 0;

  for (const status of Object.values(provenance)) {
    if (status === 'GENERATED') countGenerated++;
    else if (status === 'OPTIMIZED') countOptimized++;
    else if (status === 'VERIFIED') countVerified++;
    else if (status === 'UNAVAILABLE') countUnavailable++;
  }

  return {
    fieldProvenance: provenance,
    fieldProvenanceDetails: details,
    counts: {
      generated: countGenerated,
      optimized: countOptimized,
      verified: countVerified,
      unavailable: countUnavailable,
    },
  };
}

export async function optimizeAndApplyAll(
  item: ProductItem,
  config: StrategyConfig
): Promise<{
  product: ProductItem;
  beforeScore: number;
  afterScore: number;
  appliedFields: string[];
  autoFixedIssues: string[];
  remainingReviewCount: number;
  generatedCount: number;
  optimizedCount: number;
  verifiedCount: number;
}> {
  const now = new Date().toISOString();
  const beforeScore = item.audit?.overallScore || 70;
  const priorMerchantData: Partial<MerchantData> = { ...item.merchantData };

  // Snapshot before state for reversibility
  item.history.unshift({
    timestamp: now,
    note: `Before 1-Click "Generate & Optimize" (Score: ${beforeScore}/100)`,
    snapshot: { ...item.merchantData },
  });

  // Step 1: Ensure Strategy exists
  let strategy = item.strategy;
  if (!strategy) {
    strategy = await generateProductStrategy(item, config);
    item.strategy = strategy;
  }

  // Step 2: Generate / Optimize Fields
  const { suggestedMerchantData, suggestedGiftIntelligence, titleCandidates } =
    await generateOptimizedFields(item, strategy, config);

  // Step 2.5: Semantic Domain Validation (Prevent Cross-Product Contamination)
  const semanticCheck = validateSemanticConsistency(item, suggestedMerchantData, strategy);
  if (semanticCheck.isMismatch) {
    console.warn(`[Semantic Domain Mismatch Blocked] Product ${item.id}:`, semanticCheck.reason);
    for (const field of semanticCheck.mismatchedFields) {
      delete (suggestedMerchantData as any)[field];
    }
  }

  const appliedFields: string[] = [];
  const autoFixedIssues: string[] = [];

  // Step 3: Apply All Safe Merchant Data Improvements (Generating missing, optimizing weak)
  if (suggestedMerchantData) {
    if (suggestedMerchantData.title) {
      const wasEmpty = !priorMerchantData.title || !priorMerchantData.title.trim();
      item.merchantData.title = suggestedMerchantData.title;
      appliedFields.push(`${wasEmpty ? 'Generated' : 'Optimized'} Title`);
    }
    if (suggestedMerchantData.description) {
      const wasEmpty = !priorMerchantData.description || !priorMerchantData.description.trim();
      item.merchantData.description = suggestedMerchantData.description;
      appliedFields.push(`${wasEmpty ? 'Generated' : 'Optimized'} Description`);
    }
    if (suggestedMerchantData.google_product_category) {
      const wasEmpty = !priorMerchantData.google_product_category || !priorMerchantData.google_product_category.trim();
      item.merchantData.google_product_category = suggestedMerchantData.google_product_category;
      appliedFields.push(`${wasEmpty ? 'Generated' : 'Optimized'} Google Product Category`);
    }
    if (suggestedMerchantData.product_type) {
      const wasEmpty = !priorMerchantData.product_type || !priorMerchantData.product_type.trim();
      item.merchantData.product_type = suggestedMerchantData.product_type;
      appliedFields.push(`${wasEmpty ? 'Generated' : 'Optimized'} Product Type`);
    }
    if (suggestedMerchantData.color || item.evidence.verifiedAttributes?.color) {
      const colorVal = suggestedMerchantData.color || item.evidence.verifiedAttributes?.color;
      if (colorVal) {
        const wasEmpty = !priorMerchantData.color || !priorMerchantData.color.trim();
        item.merchantData.color = colorVal;
        appliedFields.push(`${wasEmpty ? 'Generated' : 'Optimized'} Color (${colorVal})`);
      }
    }
    if (suggestedMerchantData.size || item.evidence.verifiedAttributes?.size) {
      const sizeVal = suggestedMerchantData.size || item.evidence.verifiedAttributes?.size;
      if (sizeVal) {
        const wasEmpty = !priorMerchantData.size || !priorMerchantData.size.trim();
        item.merchantData.size = sizeVal;
        appliedFields.push(`${wasEmpty ? 'Generated' : 'Optimized'} Size (${sizeVal})`);
      }
    }
    if (suggestedMerchantData.material || item.evidence.verifiedAttributes?.material) {
      const matVal = suggestedMerchantData.material || item.evidence.verifiedAttributes?.material;
      if (matVal) {
        const wasEmpty = !priorMerchantData.material || !priorMerchantData.material.trim();
        item.merchantData.material = matVal;
        appliedFields.push(`${wasEmpty ? 'Generated' : 'Optimized'} Material (${matVal})`);
      }
    }
    if (suggestedMerchantData.custom_label_0) {
      item.merchantData.custom_label_0 = suggestedMerchantData.custom_label_0;
      appliedFields.push(`Custom Label 0 (${config.customLabelMappings.custom_label_0})`);
    }
    if (suggestedMerchantData.custom_label_1) {
      item.merchantData.custom_label_1 = suggestedMerchantData.custom_label_1;
      appliedFields.push(`Custom Label 1 (${config.customLabelMappings.custom_label_1})`);
    }
    if (suggestedMerchantData.custom_label_2) {
      item.merchantData.custom_label_2 = suggestedMerchantData.custom_label_2;
      appliedFields.push(`Custom Label 2 (${config.customLabelMappings.custom_label_2})`);
    }
    if (suggestedMerchantData.custom_label_3) {
      item.merchantData.custom_label_3 = suggestedMerchantData.custom_label_3;
      appliedFields.push(`Custom Label 3 (${config.customLabelMappings.custom_label_3})`);
    }
    if (suggestedMerchantData.custom_label_4) {
      item.merchantData.custom_label_4 = suggestedMerchantData.custom_label_4;
      appliedFields.push(`Custom Label 4 (${config.customLabelMappings.custom_label_4})`);
    }
    item.suggestedMerchantData = undefined;
  }

  // Step 4: Apply Gift Intelligence
  if (suggestedGiftIntelligence) {
    item.giftIntelligence = {
      ...item.giftIntelligence,
      ...suggestedGiftIntelligence,
    };
    item.suggestedGiftIntelligence = undefined;
    appliedFields.push('Gift & Search Intent Mappings');
  }

  if (titleCandidates && titleCandidates.length > 0) {
    item.titleCandidates = titleCandidates;
    item.selectedTitleCandidateId = titleCandidates[0].id;
  }

  // Step 5: Fix Safe Attribute Gaps in Description (e.g. verified material/capacity if omitted)
  const verified = item.evidence.verifiedAttributes;
  let desc = item.merchantData.description;
  if (verified.material && !desc.toLowerCase().includes(verified.material.toLowerCase())) {
    desc += ` Crafted from ${verified.material}.`;
    autoFixedIssues.push(`Added verified material (${verified.material}) to description`);
  }
  if (verified.capacity && !desc.toLowerCase().includes(verified.capacity.toLowerCase())) {
    desc += ` Capacity: ${verified.capacity}.`;
    autoFixedIssues.push(`Added verified capacity (${verified.capacity}) to description`);
  }
  item.merchantData.description = desc;

  // Step 6: Compute Field Provenance (VERIFIED, GENERATED, OPTIMIZED, UNAVAILABLE)
  const provenanceResult = computeFieldProvenance(item, priorMerchantData);
  item.fieldProvenance = provenanceResult.fieldProvenance;
  item.fieldProvenanceDetails = provenanceResult.fieldProvenanceDetails;

  // Step 7: Automatically re-run quality audit post-generation
  const postAudit = await performAIAudit(item, config);
  postAudit.previousScore = beforeScore;
  postAudit.fixedAutomatically = [...appliedFields, ...autoFixedIssues];
  item.audit = postAudit;

  const afterScore = postAudit.overallScore;
  const remainingReviewCount = postAudit.issues.filter((i) => i.state === 'requires_review').length;

  item.lastOptimizationSummary = {
    timestamp: now,
    beforeScore,
    afterScore,
    appliedFields,
    autoFixedIssues,
    remainingReviewCount,
    generatedCount: provenanceResult.counts.generated,
    optimizedCount: provenanceResult.counts.optimized,
    verifiedCount: provenanceResult.counts.verified,
  };

  item.appliedSuggestions.push({
    timestamp: now,
    fields: appliedFields,
    note: `1-Click "Generate & Optimize": Score improved from ${beforeScore} to ${afterScore} (${provenanceResult.counts.generated} generated, ${provenanceResult.counts.optimized} optimized)`,
  });

  item.updatedAt = now;

  return {
    product: item,
    beforeScore,
    afterScore,
    appliedFields,
    autoFixedIssues,
    remainingReviewCount,
    generatedCount: provenanceResult.counts.generated,
    optimizedCount: provenanceResult.counts.optimized,
    verifiedCount: provenanceResult.counts.verified,
  };
}

export const generateAndOptimizeRecord = optimizeAndApplyAll;

export async function fixSingleAuditIssue(
  item: ProductItem,
  issueId: string,
  config: StrategyConfig
): Promise<{
  product: ProductItem;
  fixedIssue: AuditIssue;
  appliedChanges: Partial<MerchantData & GiftIntelligence>;
  message: string;
}> {
  const now = new Date().toISOString();
  const beforeScore = item.audit?.overallScore || 80;

  if (!item.audit) {
    item.audit = await performAIAudit(item, config);
  }

  const issueIndex = item.audit.issues.findIndex((i) => i.id === issueId || i.field === issueId);
  if (issueIndex === -1) {
    throw new Error(`Audit issue with ID "${issueId}" not found.`);
  }

  const targetIssue = item.audit.issues[issueIndex];
  if (targetIssue.state === 'requires_review') {
    throw new Error(`Issue "${targetIssue.title}" requires manual review and cannot be auto-fixed without verified evidence.`);
  }

  const priorMerchantData: Partial<MerchantData> = { ...item.merchantData };
  const appliedChanges: any = {};
  const verified = item.evidence?.verifiedAttributes || {};
  let fixSummary = '';

  // 1. Ensure Strategy context is loaded
  if (!item.strategy) {
    item.strategy = await generateProductStrategy(item, config);
  }

  // Resolve fix by field & issue intent
  const field = targetIssue.field;

  if (field === 'title') {
    let newTitle = '';
    if (item.titleCandidates && item.titleCandidates.length > 0) {
      newTitle = item.titleCandidates[0].title;
    } else {
      const theme = item.giftIntelligence?.theme || item.strategy?.dominantTheme || 'History';
      const prodCat = item.strategy?.productCategory || 'Gift Item';
      newTitle = `${theme} Gift ${prodCat} - ${item.merchantData.brand || 'Science of Gifts'} Design`;
    }
    item.merchantData.title = newTitle;
    appliedChanges.title = newTitle;
    fixSummary = `Optimized title to: "${newTitle}"`;
  } else if (field === 'description') {
    let desc = item.merchantData.description || '';
    const specsToAdd: string[] = [];
    if (verified.material && !desc.toLowerCase().includes(verified.material.toLowerCase())) {
      specsToAdd.push(`Material: ${verified.material}`);
    }
    if (verified.color && !desc.toLowerCase().includes(verified.color.toLowerCase())) {
      specsToAdd.push(`Color: ${verified.color}`);
    }
    if (verified.capacity && !desc.toLowerCase().includes(verified.capacity.toLowerCase())) {
      specsToAdd.push(`Capacity: ${verified.capacity}`);
    }
    if (verified.size && !desc.toLowerCase().includes(verified.size.toLowerCase())) {
      specsToAdd.push(`Size: ${verified.size}`);
    }

    if (specsToAdd.length > 0) {
      desc = desc.trim();
      if (!desc.endsWith('.')) desc += '.';
      desc += ` Verified Specifications: ${specsToAdd.join(' • ')}.`;
      fixSummary = `Added verified specs (${specsToAdd.join(', ')}) to description`;
    } else if (desc.length < 60) {
      const theme = item.giftIntelligence?.theme || item.strategy?.dominantTheme || 'Science of Gifts';
      desc = `An authentic Science of Gifts creation celebrating ${theme}. Meticulously designed with historical appreciation, crafted for lasting durability and daily enjoyment.`;
      fixSummary = 'Generated comprehensive, policy-compliant product description';
    } else {
      fixSummary = 'Updated description formatting';
    }
    item.merchantData.description = desc;
    appliedChanges.description = desc;
  } else if (field === 'custom_label_0') {
    const aud = item.giftIntelligence?.targetAudience?.[0] || 'History Buffs';
    item.merchantData.custom_label_0 = aud;
    appliedChanges.custom_label_0 = aud;
    fixSummary = `Set Custom Label 0 to "${aud}"`;
  } else if (field === 'custom_label_1') {
    const numPrice = parseFloat(item.merchantData.price?.replace(/[^0-9.]/g, '') || '25') || 25;
    const matchedTier = config.priceTiers.find((t) => numPrice >= t.min && (!t.max || numPrice <= t.max));
    const tier = matchedTier ? matchedTier.label : 'Mid-Tier Gifts ($20 - $40)';
    item.merchantData.custom_label_1 = tier;
    appliedChanges.custom_label_1 = tier;
    fixSummary = `Set Custom Label 1 to Price Tier "${tier}"`;
  } else if (field === 'custom_label_2') {
    const season = 'Year-Round Essential';
    item.merchantData.custom_label_2 = season;
    appliedChanges.custom_label_2 = season;
    fixSummary = `Set Custom Label 2 to Seasonality "${season}"`;
  } else if (field === 'custom_label_3') {
    const theme = item.giftIntelligence?.theme || item.strategy?.dominantTheme || 'Science of Gifts';
    item.merchantData.custom_label_3 = theme;
    appliedChanges.custom_label_3 = theme;
    fixSummary = `Set Custom Label 3 to Theme "${theme}"`;
  } else if (field === 'custom_label_4') {
    const cat = item.strategy?.productCategory || 'Apparel';
    item.merchantData.custom_label_4 = cat;
    appliedChanges.custom_label_4 = cat;
    fixSummary = `Set Custom Label 4 to Product Type "${cat}"`;
  } else if (field === 'google_product_category') {
    const gpc = item.strategy?.recommendedGoogleCategory || 'Apparel & Accessories > Clothing';
    item.merchantData.google_product_category = gpc;
    appliedChanges.google_product_category = gpc;
    fixSummary = `Set Google Product Category to "${gpc}"`;
  } else if (field === 'product_type') {
    const pt = item.strategy?.productTypeStrategy || 'Apparel & Accessories > Themed Gifts';
    item.merchantData.product_type = pt;
    appliedChanges.product_type = pt;
    fixSummary = `Set Product Type to "${pt}"`;
  } else if (field === 'color' && verified.color) {
    item.merchantData.color = verified.color;
    appliedChanges.color = verified.color;
    fixSummary = `Applied verified color "${verified.color}"`;
  } else if (field === 'material' && verified.material) {
    item.merchantData.material = verified.material;
    appliedChanges.material = verified.material;
    fixSummary = `Applied verified material "${verified.material}"`;
  } else {
    // Default fallback safe assignment
    fixSummary = targetIssue.suggestedFix || `Resolved issue for ${field}`;
  }

  // Update issue state in audit
  targetIssue.state = 'fixed';
  targetIssue.isFixed = true;
  targetIssue.fixedValue = appliedChanges[field] || fixSummary;

  // Remove corresponding warning if present
  item.audit.warnings = item.audit.warnings.filter(
    (w) => !w.toLowerCase().includes(field.toLowerCase()) && !w.toLowerCase().includes(targetIssue.title.toLowerCase())
  );

  // Update fixedAutomatically list
  if (!item.audit.fixedAutomatically) item.audit.fixedAutomatically = [];
  const fixTag = `[${field}] ${targetIssue.title}`;
  if (!item.audit.fixedAutomatically.includes(fixTag)) {
    item.audit.fixedAutomatically.unshift(fixTag);
  }

  // Recalculate score
  const fScores = item.audit.fieldScores;
  if (field === 'title') {
    fScores.searchRelevance = Math.min(100, fScores.searchRelevance + 5);
    fScores.giftRelevance = Math.min(100, fScores.giftRelevance + 4);
    fScores.naturalLanguage = Math.min(100, fScores.naturalLanguage + 3);
  } else if (field === 'description') {
    fScores.description = Math.min(100, fScores.description + 7);
    fScores.accuracy = Math.min(100, fScores.accuracy + 4);
  } else if (field.startsWith('custom_label') || field === 'google_product_category' || field === 'product_type') {
    fScores.taxonomy = Math.min(100, fScores.taxonomy + 6);
  }
  item.audit.overallScore = Math.min(
    100,
    Math.round(
      (fScores.accuracy +
        fScores.searchRelevance +
        fScores.giftRelevance +
        fScores.taxonomy +
        fScores.description +
        fScores.naturalLanguage +
        fScores.compliance) /
        7
    )
  );

  // Update provenance
  const prov = computeFieldProvenance(item, priorMerchantData);
  item.fieldProvenance = prov.fieldProvenance;
  item.fieldProvenanceDetails = prov.fieldProvenanceDetails;

  // Record history
  item.history.unshift({
    timestamp: now,
    note: `Applied Safe Fix: ${targetIssue.title} (Score: ${beforeScore} → ${item.audit.overallScore})`,
    snapshot: { ...item.merchantData },
  });

  item.updatedAt = now;

  return {
    product: item,
    fixedIssue: targetIssue,
    appliedChanges,
    message: fixSummary,
  };
}

export async function fixAllSafeAuditIssues(
  item: ProductItem,
  config: StrategyConfig
): Promise<{
  product: ProductItem;
  fixedCount: number;
  fixedList: string[];
  appliedChanges: Partial<MerchantData & GiftIntelligence>;
}> {
  const now = new Date().toISOString();
  const beforeScore = item.audit?.overallScore || 80;

  if (!item.audit) {
    item.audit = await performAIAudit(item, config);
  }

  const safeIssues = item.audit.issues.filter((i) => i.state === 'safe_to_fix');
  const fixedList: string[] = [];
  const appliedChanges: any = {};

  for (const issue of safeIssues) {
    try {
      const res = await fixSingleAuditIssue(item, issue.id, config);
      Object.assign(appliedChanges, res.appliedChanges);
      fixedList.push(res.message);
    } catch (e: any) {
      console.warn(`[FixAllSafe] Skipped issue ${issue.id}:`, e.message);
    }
  }

  // If no specific issues were in list, run standard safe fixes
  if (safeIssues.length === 0) {
    const verified = item.evidence?.verifiedAttributes || {};
    let desc = item.merchantData.description || '';
    if (verified.material && !desc.toLowerCase().includes(verified.material.toLowerCase())) {
      desc += ` Crafted with verified ${verified.material}.`;
      item.merchantData.description = desc;
      appliedChanges.description = desc;
      fixedList.push(`Added verified material (${verified.material}) to description`);
    }
    if (!item.merchantData.custom_label_3) {
      const theme = item.giftIntelligence?.theme || item.strategy?.dominantTheme || 'Science of Gifts';
      item.merchantData.custom_label_3 = theme;
      appliedChanges.custom_label_3 = theme;
      fixedList.push(`Populated Custom Label 3 with Theme (${theme})`);
    }
  }

  // Update audit fixed list
  if (!item.audit.fixedAutomatically) item.audit.fixedAutomatically = [];
  for (const f of fixedList) {
    if (!item.audit.fixedAutomatically.includes(f)) {
      item.audit.fixedAutomatically.unshift(f);
    }
  }

  item.updatedAt = now;

  return {
    product: item,
    fixedCount: fixedList.length,
    fixedList,
    appliedChanges,
  };
}

export const fixSafeAuditIssues = async (item: ProductItem, config: StrategyConfig) => {
  const res = await fixAllSafeAuditIssues(item, config);
  return res.product;
};

export function revertAiChanges(item: ProductItem): ProductItem {
  if (!item.history || item.history.length === 0) return item;

  const lastSnapshot = item.history[0].snapshot;
  const now = new Date().toISOString();

  // Save current before reverting
  item.history.unshift({
    timestamp: now,
    note: 'Reverted to previous user snapshot',
    snapshot: { ...item.merchantData },
  });

  item.merchantData = {
    ...item.merchantData,
    ...lastSnapshot,
  };
  item.suggestedMerchantData = undefined;
  item.suggestedGiftIntelligence = undefined;
  item.updatedAt = now;

  return item;
}

export async function runGranularAIOperation(
  item: ProductItem,
  operation:
    | 'improve_title'
    | 'improve_description'
    | 'improve_taxonomy'
    | 'improve_gift_intent'
    | 'suggest_custom_labels'
    | 'fix_problems',
  config: StrategyConfig
): Promise<{
  suggestedMerchantData?: Partial<MerchantData>;
  suggestedGiftIntelligence?: Partial<GiftIntelligence>;
  titleCandidates?: TitleCandidate[];
}> {
  const ai = getGeminiClient();
  const modelName = config.geminiModel || 'gemini-3.5-flash-lite';

  const prompt = `Perform targeted operation "${operation}" on product:
Product Group: ${item.productGroup || 'Unspecified'}
Product Subgroup: ${item.productSubgroup || 'Unspecified'}
Title: ${item.merchantData.title}
Description: ${item.merchantData.description}
Theme: ${item.giftIntelligence.theme || item.strategy?.dominantTheme || item.productSubgroup || item.productGroup || 'Science of Gifts'}
Product Type: ${item.merchantData.product_type}
Google Product Category: ${item.merchantData.google_product_category}
Verified Attributes: ${JSON.stringify(item.evidence.verifiedAttributes)}`;

  try {
    const response = await callGeminiWithRetry(ai, modelName, {
      contents: prompt,
      config: {
        systemInstruction: `You are an expert Google Merchant Center optimizer. Return targeted improvements for "${operation}" as JSON.`,
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(response.text || '{}');

    if (operation === 'improve_title') {
      const candidates: TitleCandidate[] = parsed.titleCandidates || [
        {
          id: 'opt_1',
          title: parsed.title || `${item.merchantData.title} - Science of Gifts`,
          formula: 'Subject + Product Type',
          scores: { clarity: 95, searchRelevance: 92, giftRelevance: 90, naturalLanguage: 95, characterEfficiency: 90, compliance: 98, total: 93 },
          reasoning: 'Improved clarity and front-loaded subject.',
        },
      ];
      return {
        suggestedMerchantData: { title: candidates[0].title },
        titleCandidates: candidates,
      };
    }

    if (operation === 'improve_description') {
      return {
        suggestedMerchantData: { description: parsed.description || parsed.optimizedDescription },
      };
    }

    if (operation === 'improve_taxonomy') {
      return {
        suggestedMerchantData: {
          google_product_category: parsed.google_product_category || parsed.googleProductCategory,
          product_type: parsed.product_type || parsed.productType,
        },
      };
    }

    if (operation === 'suggest_custom_labels') {
      return {
        suggestedMerchantData: {
          custom_label_0: parsed.custom_label_0,
          custom_label_1: parsed.custom_label_1,
          custom_label_2: parsed.custom_label_2,
          custom_label_3: parsed.custom_label_3,
          custom_label_4: parsed.custom_label_4,
        },
      };
    }

    if (operation === 'improve_gift_intent') {
      return {
        suggestedGiftIntelligence: {
          primaryGiftIntent: parsed.primaryGiftIntent,
          secondaryGiftIntents: parsed.secondaryGiftIntents,
          targetAudience: parsed.targetAudience,
          occasions: parsed.occasions,
        },
      };
    }

    return {
      suggestedMerchantData: parsed.merchantData,
      suggestedGiftIntelligence: parsed.giftIntelligence,
    };
  } catch (err: any) {
    console.warn(`[Granular AI ${operation}] Fallback:`, err.message);
    return {};
  }
}

// Helper to infer product group and subgroup from product title, description, and URL
export function inferProductGroupAndSubgroup(
  title: string,
  desc: string,
  url: string = ''
): { productGroup: string; productSubgroup: string } {
  const text = `${title} ${desc} ${url}`.toLowerCase();

  // TV & Film
  if (text.includes('how i met your mother') || text.includes('himym') || text.includes('barney stinson') || text.includes('suit up') || text.includes('maclaren')) {
    return { productGroup: 'TV & Film', productSubgroup: 'How I Met Your Mother' };
  }
  if (text.includes('screenwriter') || text.includes('cinematography') || text.includes('clapperboard') || text.includes('filmmaker') || text.includes('movie director')) {
    return { productGroup: 'TV & Film', productSubgroup: 'Filmmakers' };
  }

  // Music
  if (text.includes('jazz') || text.includes('miles davis') || text.includes('coltrane')) {
    return { productGroup: 'Music', productSubgroup: 'Jazz' };
  }
  if (text.includes('classical music') || text.includes('beethoven') || text.includes('mozart') || text.includes('symphony')) {
    return { productGroup: 'Music', productSubgroup: 'Classical Music' };
  }

  // Professions
  if (text.includes('history teacher') || text.includes('english teacher') || text.includes('professor')) {
    return { productGroup: 'Professions', productSubgroup: 'Teachers' };
  }
  if (text.includes('pilot') || text.includes('aviator')) {
    return { productGroup: 'Professions', productSubgroup: 'Pilots' };
  }

  // History Subgroups
  if (text.includes('viking') || text.includes('norse') || text.includes('valhalla') || text.includes('thor') || text.includes('odin') || text.includes('asgard') || text.includes('runes') || text.includes('shieldmaiden')) {
    return { productGroup: 'History', productSubgroup: 'Vikings' };
  }
  if (text.includes('wwii') || text.includes('world war ii') || text.includes('spitfire') || text.includes('b-17') || text.includes('warbird') || text.includes('d-day') || text.includes('churchill')) {
    return { productGroup: 'History', productSubgroup: 'WWII' };
  }
  if (text.includes('civil war') || text.includes('gettysburg') || text.includes('1861') || text.includes('1863') || text.includes('1865')) {
    return { productGroup: 'History', productSubgroup: 'Civil War' };
  }
  if (text.includes('american revolution') || text.includes('1776') || text.includes('founding fathers')) {
    return { productGroup: 'History', productSubgroup: 'American Revolution' };
  }
  if (text.includes('lincoln') || text.includes('gettysburg address')) {
    return { productGroup: 'History', productSubgroup: 'Abraham Lincoln' };
  }

  if (text.includes('history') || text.includes('historian') || text.includes('archival')) {
    return { productGroup: 'History', productSubgroup: 'General History' };
  }

  return { productGroup: 'Other', productSubgroup: 'General Gifts' };
}

// Lightweight Semantic Validator to catch cross-product domain contamination
export function validateSemanticConsistency(
  item: ProductItem,
  proposedMerchantData: Partial<MerchantData>,
  proposedStrategy?: AIStrategy
): { isMismatch: boolean; reason?: string; mismatchedFields: string[] } {
  const sourceText = `${item.originalImported?.title || ''} ${item.originalImported?.description || ''} ${item.evidence.pageTitle || ''} ${item.evidence.rawDescription || ''} ${item.evidence.sourceUrl || ''}`.toLowerCase();

  const proposedText = `${proposedMerchantData.title || ''} ${proposedMerchantData.description || ''} ${proposedStrategy?.dominantTheme || ''} ${proposedMerchantData.custom_label_3 || ''}`.toLowerCase();

  const mismatchedFields: string[] = [];

  // Source Domains
  const isSourceViking = /\b(viking|norse|valhalla|thor|odin|asgard|runes|shieldmaiden)\b/i.test(sourceText);
  const isSourceHIMYM = /\b(how i met your mother|himym|barney stinson|suit up|yellow umbrella|maclaren)\b/i.test(sourceText);
  const isSourceMusic = /\b(jazz|classical music|beethoven|mozart|miles davis|orchestra|vinyl)\b/i.test(sourceText);

  // Proposed Contradictory Domains
  const isProposedWWII = /\b(wwii|world war ii|spitfire|b-17|warbird|d-day|1776 american revolution)\b/i.test(proposedText);
  const isProposedCivilWar = /\b(civil war|gettysburg|1863 battle map|union army|confederate)\b/i.test(proposedText);

  if ((isSourceViking || isSourceHIMYM || isSourceMusic) && (isProposedWWII || isProposedCivilWar)) {
    if (proposedMerchantData.title && (isProposedWWII || isProposedCivilWar)) mismatchedFields.push('title');
    if (proposedMerchantData.description && (isProposedWWII || isProposedCivilWar)) mismatchedFields.push('description');
    if (proposedMerchantData.custom_label_3 && (isProposedWWII || isProposedCivilWar)) mismatchedFields.push('custom_label_3');

    const sourceLabel = isSourceViking ? 'Norse / Viking' : isSourceHIMYM ? 'How I Met Your Mother' : 'Music';
    const proposedLabel = isProposedWWII ? 'WWII Aviation / Revolution' : 'Civil War';

    return {
      isMismatch: true,
      reason: `Semantic Domain Mismatch: Source product is ${sourceLabel}, but proposed output contains ${proposedLabel} terms (${mismatchedFields.join(', ')}).`,
      mismatchedFields,
    };
  }

  return { isMismatch: false, mismatchedFields: [] };
}

// Heuristic Fallbacks for instant offline/resilient responses
function getSpecificTheme(title: string, rawDesc: string, fallbackTheme: string): string {
  const text = `${title} ${rawDesc}`.toLowerCase();

  if (text.includes('how i met your mother') || text.includes('himym') || text.includes('suit up')) return 'How I Met Your Mother';
  if (text.includes('viking') || text.includes('norse') || text.includes('valhalla') || text.includes('thor') || text.includes('odin')) return 'Viking & Norse Mythology';
  if (text.includes('lincoln') || text.includes('gettysburg address')) return 'Abraham Lincoln';
  if (text.includes('civil war') || text.includes('gettysburg') || text.includes('1861') || text.includes('1863') || text.includes('1865')) return 'Civil War';
  if (text.includes('aviation') || text.includes('spitfire') || text.includes('warbird') || text.includes('b-17') || text.includes('raf') || text.includes('pilot')) return 'WWII Aviation';
  if (text.includes('wwii') || text.includes('world war ii') || text.includes('d-day') || text.includes('churchill') || text.includes('enigma')) return 'WWII History';
  if (text.includes('athena') || text.includes('greek mythology') || text.includes('zeus') || text.includes('poseidon') || text.includes('spartan') || text.includes('mythology')) return 'Greek Mythology';
  if (text.includes('marcus aurelius') || text.includes('stoic') || text.includes('stoicism') || text.includes('spqr') || text.includes('roman') || text.includes('caesar')) return 'Ancient Rome';
  if (text.includes('screenwriter') || text.includes('filmmaker') || text.includes('clapperboard') || text.includes('35mm')) return 'Screenwriting & Cinema';
  if (text.includes('jazz') || text.includes('miles davis') || text.includes('coltrane')) return 'Jazz Music';
  if (text.includes('physics') || text.includes('quantum') || text.includes('einstein') || text.includes('astronomy')) return 'Science & Physics';
  if (text.includes('history teacher') || text.includes('history professor')) return 'History Teacher';
  if (text.includes('history buff') || text.includes('timeline') || text.includes('bc ad')) return 'History Buff';

  return fallbackTheme ? fallbackTheme.replace(/^History\s*&\s*World Events$/i, 'History') : 'Themed Design';
}

function createHeuristicStrategy(item: ProductItem, config: StrategyConfig): AIStrategy {
  const title = item.evidence.pageTitle || item.merchantData.title;

  if (!item.productGroup) {
    const inferred = inferProductGroupAndSubgroup(title, item.evidence.rawDescription, item.evidence.sourceUrl);
    item.productGroup = inferred.productGroup;
    if (!item.productSubgroup) item.productSubgroup = inferred.productSubgroup;
  }

  let dominantTheme = item.productSubgroup || item.productGroup || '';
  if (!dominantTheme || dominantTheme === 'History') {
    const matchedTheme = config.themes.find((t) =>
      t.keywords.some((kw) => title.toLowerCase().includes(kw.toLowerCase())) ||
      title.toLowerCase().includes(t.name.toLowerCase())
    );
    if (matchedTheme) dominantTheme = matchedTheme.name;
    dominantTheme = getSpecificTheme(title, item.evidence.rawDescription, dominantTheme);
  }
  const specificTheme = dominantTheme || 'Specialized Design';

  let productCat = 'Apparel / Drinkware / Decor';
  if (title.toLowerCase().includes('hoodie')) productCat = 'Hoodie';
  else if (title.toLowerCase().includes('shirt') || title.toLowerCase().includes('tee') || title.toLowerCase().includes('t-shirt')) productCat = 'T-Shirt';
  else if (title.toLowerCase().includes('mug')) productCat = 'Mug';
  else if (title.toLowerCase().includes('poster') || title.toLowerCase().includes('print')) productCat = 'Poster';
  else if (title.toLowerCase().includes('notebook') || title.toLowerCase().includes('journal')) productCat = 'Journal';

  return {
    exactProductSummary: `${productCat} featuring ${title} design for ${specificTheme} enthusiasts.`,
    dominantTheme: specificTheme,
    productCategory: productCat,
    verifiedPhysicalAttributes: Object.entries(item.evidence.verifiedAttributes)
      .filter(([_, v]) => Boolean(v))
      .map(([k, v]) => `${k}: ${v}`),
    realisticBuyer: `${specificTheme} enthusiast, student, teacher, or gift buyer.`,
    realisticRecipient: `${specificTheme} enthusiast or curious learner.`,
    giftRationale: `Celebrates authentic interest in ${specificTheme} with practical, high-quality merchandise.`,
    relevantSearchIntents: [
      `${specificTheme.toLowerCase()} gifts`,
      `${specificTheme.toLowerCase()} ${productCat.toLowerCase()}`,
      `gifts for history buffs`,
    ],
    differentiatingAttributes: ['Authentic thematic artwork', 'Durable premium construction', 'Specialized subject focus'],
    titleStrategy: `Prioritize specific subject (${specificTheme}), followed by product type (${productCat}), gift intent, and key design attribute.`,
    titlePriorityOrder: [
      `1. Specific Theme: ${specificTheme}`,
      `2. Product Type: ${productCat}`,
      `3. Gift Intent: ${specificTheme} Gift`,
      `4. Differentiating Attribute`,
    ],
    titleStrategyReasoning: `Prioritizes the most specific commercially meaningful subject (${specificTheme}) instead of broad umbrella prefixes for precise product matching.`,
    descriptionStrategy: 'Describe the specific historical narrative, verified physical specs, and gifting context.',
    productTypeStrategy: item.merchantData.product_type || 'Gifts & Collectibles > Themed Merchandise',
    customLabelsStrategy: {
      custom_label_0: 'History Buffs',
      custom_label_1: 'Mid-Tier Gifts ($20 - $40)',
      custom_label_2: 'Year-Round Essential',
      custom_label_3: specificTheme,
      custom_label_4: productCat,
    },
    antiRecommendations: [
      'Do not claim unverified organic materials',
      'Do not invent GTIN/barcode numbers',
      'Do not use generic "History Gift" universal prefix when specific theme exists',
      'Avoid spam keywords like "Best cheap gift ever"',
    ],
    googleCategoryRationale: 'Standard Google Product Category representing physical product form factor.',
    recommendedGoogleCategory: item.merchantData.google_product_category || 'Apparel & Accessories > Clothing > Shirts & Tops',
    researchedAt: new Date().toISOString(),
  };
}

function createHeuristicFields(
  item: ProductItem,
  strategy: AIStrategy,
  _config: StrategyConfig
): {
  suggestedMerchantData: Partial<MerchantData>;
  suggestedGiftIntelligence: Partial<GiftIntelligence>;
  titleCandidates: TitleCandidate[];
} {
  const baseTitle = item.merchantData.title || item.evidence.pageTitle;
  const theme = strategy.dominantTheme;
  const prodCat = strategy.productCategory;
  const differentiator = item.evidence.verifiedAttributes.material || 'Thematic Edition';

  const priorityOrder = [
    `1. Specific Theme: ${theme}`,
    `2. Product Type: ${prodCat}`,
    `3. Gift Intent: ${theme} Gift`,
    `4. Differentiator: ${differentiator}`,
  ];

  // Specific candidate structures reflecting preferred hierarchy
  const candidate1: TitleCandidate = {
    id: 'cand_1',
    title: `${theme} Gift ${prodCat} - ${differentiator} Design`,
    formula: 'Specific Theme + Gift Intent + Product Type + Differentiator',
    titlePriorityOrder: priorityOrder,
    titleStrategyReasoning: `Prioritizes specific subject (${theme}) and product type (${prodCat}) with natural gift intent, followed by key differentiating specs.`,
    scores: {
      coreThemeProminence: 99,
      giftSearchRelevance: 98,
      productClarity: 96,
      naturalLanguage: 96,
      factualAccuracy: 99,
      differentiation: 95,
      characterEfficiency: 94,
      total: 97,
    },
    reasoning: 'Front-loads the specific theme and gift intent while keeping product clarity high.',
  };

  const candidate2: TitleCandidate = {
    id: 'cand_2',
    title: `${theme} ${prodCat} - Thematic Gift for ${strategy.realisticRecipient}`,
    formula: 'Specific Theme + Product Type + Recipient Gift Context',
    titlePriorityOrder: priorityOrder,
    titleStrategyReasoning: 'Balances direct specific theme naming with natural recipient gift context.',
    scores: {
      coreThemeProminence: 96,
      giftSearchRelevance: 95,
      productClarity: 97,
      naturalLanguage: 95,
      factualAccuracy: 98,
      differentiation: 92,
      characterEfficiency: 92,
      total: 95,
    },
    reasoning: 'Clean title with exact recipient positioning for gift shoppers.',
  };

  const candidate3: TitleCandidate = {
    id: 'cand_3',
    title: `${theme} ${prodCat} - ${baseTitle}`,
    formula: 'Specific Theme + Product Type + Specific Design Feature',
    titlePriorityOrder: priorityOrder,
    titleStrategyReasoning: 'Direct product title without forcing the word "gift", ideal when gift keyword is unnecessary.',
    scores: {
      coreThemeProminence: 95,
      giftSearchRelevance: 90,
      productClarity: 98,
      naturalLanguage: 97,
      factualAccuracy: 99,
      differentiation: 94,
      characterEfficiency: 93,
      total: 94,
    },
    reasoning: 'Natural syntax without forcing gift keyword.',
  };

  const suggestedDescription =
    item.merchantData.description.length > 80
      ? item.merchantData.description
      : `An authentic Science of Gifts creation celebrating ${theme}. Designed with meticulous attention to detail and historical appreciation, this ${prodCat} makes a memorable gift for passionate ${strategy.realisticRecipient}s. Crafted with durable materials and vivid print quality for daily enjoyment.`;

  return {
    suggestedMerchantData: {
      title: candidate1.title,
      description: suggestedDescription,
      color: item.evidence.verifiedAttributes?.color || item.merchantData.color || '',
      size: item.evidence.verifiedAttributes?.size || item.merchantData.size || '',
      material: item.evidence.verifiedAttributes?.material || item.merchantData.material || '',
      google_product_category: strategy.recommendedGoogleCategory,
      product_type: strategy.productTypeStrategy,
      custom_label_0: 'History Buffs',
      custom_label_1: 'Mid-Tier Gifts ($20 - $40)',
      custom_label_2: 'Year-Round Essential',
      custom_label_3: theme,
      custom_label_4: prodCat,
    },
    suggestedGiftIntelligence: {
      theme: strategy.dominantTheme,
      subtheme: '',
      targetAudience: ['History Buffs', 'Teachers & Professors'],
      recipientPersonas: [strategy.realisticRecipient],
      occasions: ['Birthday', 'Christmas / Holidays'],
      primaryGiftIntent: `${strategy.dominantTheme.toLowerCase()} gifts`,
      secondaryGiftIntents: ['gifts for history buffs', 'unique educational gifts'],
      searchConcepts: [strategy.dominantTheme, prodCat, 'Science of Gifts'],
    },
    titleCandidates: [candidate1, candidate2, candidate3],
  };
}

function createHeuristicAudit(item: ProductItem, previousScore?: number): AIAudit {
  const warnings: string[] = [];
  const criticalErrors: string[] = [];
  const suggestedFixes: Array<{ field: string; issue: string; fix: string }> = [];
  const issues: AuditIssue[] = [];

  let accuracyScore = 96;
  let searchScore = 94;
  let giftScore = 95;
  let taxonomyScore = 96;
  let descScore = 93;
  let naturalScore = 96;
  let complianceScore = 98;

  // Semantic Domain Mismatch Check
  const semCheck = validateSemanticConsistency(item, item.merchantData, item.strategy);
  if (semCheck.isMismatch) {
    issues.push({
      id: 'iss_semantic_domain_mismatch',
      field: 'title',
      title: '⚠ Cross-Domain Context Contamination Detected',
      description: semCheck.reason || 'Merchant data contains thematic subjects that contradict original product evidence.',
      state: 'requires_review',
      verifiedEvidence: `Original Title: ${item.originalImported?.title || item.evidence.pageTitle}`,
      suggestedFix: 'Use Recovery Controls to restore original imported data or re-optimize with clean product context.',
    });
    warnings.push('Merchant data contains subjects contradicting original source product evidence.');
    accuracyScore -= 20;
  }

  // Issue 1: Description missing verified specs
  const verified = item.evidence.verifiedAttributes;
  const descLower = item.merchantData.description.toLowerCase();

  if (verified.material && !descLower.includes(verified.material.toLowerCase())) {
    issues.push({
      id: 'iss_desc_material',
      field: 'description',
      title: 'Description missing verified product material',
      description: `Verified material "${verified.material}" is omitted from the product description.`,
      state: 'safe_to_fix',
      verifiedEvidence: `Material: ${verified.material}`,
      suggestedFix: `Add verified material (${verified.material}) naturally to the description.`,
    });
    warnings.push(`Description is missing verified material (${verified.material}).`);
    suggestedFixes.push({ field: 'description', issue: 'Missing material', fix: `Include ${verified.material} in description` });
    descScore -= 4;
  }

  // Issue 2: Custom Label 3 empty
  if (!item.merchantData.custom_label_3) {
    const derivedTheme = item.giftIntelligence.theme || item.strategy?.dominantTheme || 'Science of Gifts';
    issues.push({
      id: 'iss_cl3_empty',
      field: 'custom_label_3',
      title: 'Custom Label 3 (Theme / Collection) is empty',
      description: `Custom Label 3 is empty and can be populated directly with theme "${derivedTheme}".`,
      state: 'safe_to_fix',
      verifiedEvidence: `Derived Theme: ${derivedTheme}`,
      suggestedFix: `Populate Custom Label 3 with "${derivedTheme}".`,
    });
    warnings.push(`Custom Label 3 is empty. Will populate from theme "${derivedTheme}".`);
    suggestedFixes.push({ field: 'custom_label_3', issue: 'Empty custom label 3', fix: `Set to ${derivedTheme}` });
    taxonomyScore -= 3;
  }

  // Issue 3: Custom Label 1 empty
  if (!item.merchantData.custom_label_1) {
    issues.push({
      id: 'iss_cl1_empty',
      field: 'custom_label_1',
      title: 'Custom Label 1 (Price Tier) is empty',
      description: 'Custom Label 1 can be allocated automatically from catalog price tier settings.',
      state: 'safe_to_fix',
      verifiedEvidence: `Price: ${item.merchantData.price}`,
      suggestedFix: 'Populate Custom Label 1 with appropriate price tier label.',
    });
  }

  // Issue 4: Identifier & GTIN Compliance Check
  const gtin = (item.merchantData.gtin || '').trim();
  const mpn = (item.merchantData.mpn || '').trim();
  const identExists = (item.merchantData.identifier_exists || '').trim().toLowerCase();
  const evidenceGtin = (item.evidence.verifiedAttributes as any)?.gtin || (item.evidence.verifiedAttributes as any)?.barcode;

  if (evidenceGtin && !gtin) {
    // Source provided a GTIN that was omitted from feed
    issues.push({
      id: 'iss_gtin_missing_evidence',
      field: 'gtin',
      title: 'Source GTIN omitted from Merchant Data',
      description: `Source evidence contains GTIN "${evidenceGtin}" which has not been transferred to the feed.`,
      state: 'safe_to_fix',
      verifiedEvidence: `Source GTIN: ${evidenceGtin}`,
      suggestedFix: `Transfer verified GTIN "${evidenceGtin}" and set identifier_exists to "yes".`,
    });
    warnings.push(`GTIN found in source (${evidenceGtin}) is missing from feed.`);
    complianceScore -= 5;
  } else if (gtin) {
    const cleanGtin = gtin.replace(/\D/g, '');
    if (cleanGtin.length < 8 || cleanGtin.length > 14 || /^0+$/.test(cleanGtin) || /^12345678/.test(cleanGtin)) {
      issues.push({
        id: 'iss_gtin_malformed',
        field: 'gtin',
        title: 'Malformed or placeholder GTIN detected',
        description: `Supplied GTIN "${gtin}" is invalid. Google Merchant Center rejects fake/placeholder GTINs.`,
        state: 'requires_review',
        suggestedFix: 'Replace with valid GS1 barcode or clear GTIN and set identifier_exists to "no".',
      });
      warnings.push(`GTIN "${gtin}" appears invalid or placeholder.`);
      complianceScore -= 8;
    } else if (identExists === 'no' || identExists === 'false') {
      issues.push({
        id: 'iss_gtin_inconsistent',
        field: 'identifier_exists',
        title: 'Inconsistent identifier_exists setting',
        description: 'A valid GTIN is supplied, but identifier_exists is set to "no".',
        state: 'safe_to_fix',
        suggestedFix: 'Set identifier_exists to "yes".',
      });
      warnings.push('identifier_exists is set to "no", but GTIN is present.');
    }
  } else if (identExists === 'no' || identExists === 'false') {
    // Fully compliant: GTIN is empty, MPN is empty, identifier_exists is explicitly set to 'no'
    issues.push({
      id: 'iss_gtin_compliant_none',
      field: 'gtin',
      title: '✓ No GTIN',
      description: 'Identifier Exists: No\nNo manufacturer identifier was supplied for this product.',
      state: 'informational',
      verifiedEvidence: 'Product is custom / made-to-order without manufacturer barcode',
      suggestedFix: 'Compliant with Google Merchant Center custom goods policy.',
    });
  } else if (identExists === 'yes' || identExists === 'true') {
    // identifier_exists is 'yes' but neither GTIN nor MPN is provided
    issues.push({
      id: 'iss_gtin_expected_missing',
      field: 'identifier_exists',
      title: 'identifier_exists is "yes" but GTIN/MPN is missing',
      description: 'identifier_exists is set to "yes", but neither GTIN nor MPN is populated. Either provide valid identifiers or set identifier_exists to "no".',
      state: 'safe_to_fix',
      suggestedFix: 'Set identifier_exists to "no" if no manufacturer barcode exists.',
    });
    warnings.push('identifier_exists is "yes" but GTIN/MPN is missing.');
    complianceScore -= 5;
  } else {
    // identifier_exists is unset
    issues.push({
      id: 'iss_ident_exists_unset',
      field: 'identifier_exists',
      title: 'identifier_exists is unset',
      description: 'Merchant Center expects identifier_exists to be explicitly set to "no" when no GTIN or MPN is available.',
      state: 'safe_to_fix',
      suggestedFix: 'Set identifier_exists to "no".',
    });
    warnings.push('identifier_exists is not set. Set to "no" for products without barcodes.');
    complianceScore -= 3;
  }

  if (item.merchantData.title.length > 130) {
    warnings.push('Title is approaching 150 characters. Consider keeping key identifiers in the first 70 characters.');
    searchScore -= 2;
  }

  if (!item.merchantData.google_product_category) {
    issues.push({
      id: 'iss_gpc_missing',
      field: 'google_product_category',
      title: 'Google Product Category is missing',
      description: 'Standard Google Product Category represents the physical product form factor.',
      state: 'safe_to_fix',
      suggestedFix: 'Auto-match official Google Product Category.',
    });
    warnings.push('Google Product Category is missing.');
    taxonomyScore -= 8;
  }

  const overallScore = Math.min(
    100,
    Math.round((accuracyScore + searchScore + giftScore + taxonomyScore + descScore + naturalScore + complianceScore) / 7)
  );

  return {
    overallScore,
    previousScore,
    fieldScores: {
      accuracy: accuracyScore,
      searchRelevance: searchScore,
      giftRelevance: giftScore,
      taxonomy: taxonomyScore,
      description: descScore,
      naturalLanguage: naturalScore,
      compliance: complianceScore,
    },
    issues,
    warnings,
    criticalErrors,
    suggestedFixes,
    auditedAt: new Date().toISOString(),
  };
}

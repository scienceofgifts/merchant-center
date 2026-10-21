import fs from 'fs';
import path from 'path';
import { ProductItem, StrategyConfig } from '../src/types/feed';
import { INITIAL_STRATEGY_CONFIG } from '../src/utils/taxonomy';
import { computeProductStatus } from '../src/utils/validation';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'catalog.json');
const STRATEGY_FILE = path.join(DATA_DIR, 'strategy.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadStrategyConfig(): StrategyConfig {
  ensureDataDir();
  if (fs.existsSync(STRATEGY_FILE)) {
    try {
      const raw = fs.readFileSync(STRATEGY_FILE, 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      console.warn('[Storage] Error reading strategy config, using default:', err);
    }
  }
  saveStrategyConfig(INITIAL_STRATEGY_CONFIG);
  return INITIAL_STRATEGY_CONFIG;
}

export function saveStrategyConfig(config: StrategyConfig): void {
  ensureDataDir();
  fs.writeFileSync(STRATEGY_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function loadCatalog(): ProductItem[] {
  ensureDataDir();
  if (fs.existsSync(PRODUCTS_FILE)) {
    try {
      const raw = fs.readFileSync(PRODUCTS_FILE, 'utf-8');
      const items: ProductItem[] = JSON.parse(raw);
      // Re-evaluate validation and status dynamically
      return items.map((item) => {
        const { status, validation } = computeProductStatus(item, items);
        return {
          ...item,
          status: item.status === 'not_analyzed' ? 'not_analyzed' : status,
          validation,
        };
      });
    } catch (err) {
      console.warn('[Storage] Error reading catalog file, generating sample data:', err);
    }
  }

  const initialItems = createInitialSampleCatalog();
  saveCatalog(initialItems);
  return initialItems;
}

export function saveCatalog(items: ProductItem[]): void {
  ensureDataDir();
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(items, null, 2), 'utf-8');
}

function createInitialSampleCatalog(): ProductItem[] {
  const now = new Date().toISOString();

  const p1: ProductItem = {
    id: 'sog_civil_war_hoodie',
    productGroup: 'History',
    productSubgroup: 'Civil War',
    status: 'optimized',
    evidence: {
      sourceUrl: 'https://scienceofgifts.fourthwall.com/products/civil-war-hoodie',
      extractedAt: now,
      pageTitle: 'Civil War History Heavyweight Hoodie | Science of Gifts',
      rawDescription: 'Premium heavyweight cotton fleece hoodie featuring hand-restored 1863 battle mapping. Double-lined hood, ribbed cuffs, kangaroo pouch pocket. 80% cotton, 20% polyester.',
      verifiedAttributes: {
        brand: 'Science of Gifts',
        material: '80% Cotton / 20% Polyester',
        color: 'Heather Charcoal',
        size: 'L',
        features: ['Heavyweight Fleece', 'Front Kangaroo Pocket', 'Matching Drawstrings'],
      },
      unresolvedAttributes: ['GTIN (Custom Made)', 'MPN'],
      confidenceScores: { pageTitle: 1.0, material: 0.98, price: 1.0 },
      variants: [
        { id: 'var_cw_s', title: 'Small / Heather Charcoal', price: '49.99 USD', color: 'Heather Charcoal', size: 'S', available: true },
        { id: 'var_cw_m', title: 'Medium / Heather Charcoal', price: '49.99 USD', color: 'Heather Charcoal', size: 'M', available: true },
        { id: 'var_cw_l', title: 'Large / Heather Charcoal', price: '49.99 USD', color: 'Heather Charcoal', size: 'L', available: true },
        { id: 'var_cw_xl', title: 'XL / Heather Charcoal', price: '49.99 USD', color: 'Heather Charcoal', size: 'XL', available: true },
      ],
      images: [
        'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=800&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?w=800&auto=format&fit=crop&q=80',
      ],
      userCorrections: {},
    },
    merchantData: {
      id: 'sog_civil_war_hoodie',
      link: 'https://scienceofgifts.fourthwall.com/products/civil-war-hoodie',
      title: 'Civil War Gift Hoodie - 1863 Battle Map Heavyweight Fleece',
      description: 'Celebrate American history with this premium heavyweight fleece hoodie from Science of Gifts. Features authentic 1863 battle cartography rendered in archival detail. Crafted from 80% cotton and 20% polyester blend with double-stitched seams and a cozy kangaroo pocket. An ideal gift for civil war historians, teachers, and history enthusiasts.',
      image_link: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=800&auto=format&fit=crop&q=80',
      additional_image_link: 'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?w=800&auto=format&fit=crop&q=80',
      google_product_category: 'Apparel & Accessories > Clothing > Outerwear > Sweatshirts & Hoodies',
      product_type: 'Apparel > Hoodies > History Themed',
      price: '49.99 USD',
      availability: 'in_stock',
      brand: 'Science of Gifts',
      gtin: '',
      mpn: '',
      identifier_exists: 'no',
      item_group_id: 'grp_sog_civil_war_hoodie',
      color: 'Heather Charcoal',
      size: 'L',
      material: '80% Cotton / 20% Polyester',
      gender: 'unisex',
      age_group: 'adult',
      condition: 'new',
      custom_label_0: 'History Buffs',
      custom_label_1: 'Premium Gifts ($40 - $75)',
      custom_label_2: 'Year-Round Essential',
      custom_label_3: 'American Civil War',
      custom_label_4: 'Hoodies & Sweatshirts',
    },
    giftIntelligence: {
      theme: 'American Civil War',
      subtheme: 'Gettysburg & 1863 Campaign',
      targetAudience: ['History Buffs', 'History Teachers', 'Civil War Reenactors'],
      recipientPersonas: ['History Teacher', 'Dad / Grandfather', 'History Major'],
      occasions: ['Birthday', 'Christmas / Holidays', 'Father’s Day'],
      primaryGiftIntent: 'civil war gifts',
      secondaryGiftIntents: ['gifts for history buffs', 'history teacher hoodie', 'civil war apparel'],
      searchConcepts: ['Civil War 1863', 'History Hoodie', 'Battle Map', 'Historian Gift'],
    },
    titleCandidates: [
      {
        id: 'tc_1',
        title: 'Civil War Gift Hoodie - 1863 Battle Map Heavyweight Fleece',
        formula: 'Core Theme + Primary Gift Intent + Product Type + Key Differentiator',
        titlePriorityOrder: [
          '1. Core Theme: American Civil War',
          '2. Primary Gift Intent: Civil War Gift',
          '3. Product Type: Hoodie',
          '4. Key Differentiator: 1863 Battle Map',
          '5. Material: Heavyweight Fleece',
        ],
        titleStrategyReasoning: 'Prioritizes the core theme and primary gift search intent ("Civil War Gift Hoodie") near the beginning for immediate search matching, followed by the specific 1863 cartography differentiator.',
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
        reasoning: 'Front-loads "Civil War Gift Hoodie" for high-intent searchers and immediately communicates the historical theme and product type.',
      },
      {
        id: 'tc_2',
        title: 'Civil War 1863 Battle Map Heavyweight Hoodie - Gift for History Buffs',
        formula: 'Core Theme + Differentiator + Product Type + Recipient Gift Intent',
        titlePriorityOrder: [
          '1. Core Theme: Civil War',
          '2. Differentiator: 1863 Battle Map',
          '3. Product Type: Heavyweight Hoodie',
          '4. Recipient Context: Gift for History Buffs',
        ],
        titleStrategyReasoning: 'Emphasizes the specific 1863 battle cartography before the garment type, with gift recipient context at the tail.',
        scores: {
          coreThemeProminence: 96,
          giftSearchRelevance: 94,
          productClarity: 95,
          naturalLanguage: 95,
          factualAccuracy: 99,
          differentiation: 96,
          characterEfficiency: 92,
          total: 95,
        },
        reasoning: 'Strong alternative when shopper searches for specific cartography or battle map terms.',
      },
      {
        id: 'tc_3',
        title: 'American Civil War Collection Hoodie (Heather Charcoal 1863 Map)',
        formula: 'Brand Collection + Product Type + Color + Spec',
        titlePriorityOrder: [
          '1. Collection: American Civil War',
          '2. Product Type: Hoodie',
          '3. Spec: Heather Charcoal 1863 Map',
        ],
        titleStrategyReasoning: 'Standard catalog collection format prioritizing brand and color.',
        scores: {
          coreThemeProminence: 92,
          giftSearchRelevance: 88,
          productClarity: 94,
          naturalLanguage: 94,
          factualAccuracy: 98,
          differentiation: 91,
          characterEfficiency: 91,
          total: 91,
        },
        reasoning: 'Clean direct title for non-gift catalog matching.',
      },
    ],
    selectedTitleCandidateId: 'tc_1',
    strategy: {
      exactProductSummary: 'Heavyweight fleece hoodie printed with 1863 Civil War battle map.',
      dominantTheme: 'American Civil War',
      productCategory: 'Hoodies & Sweatshirts',
      verifiedPhysicalAttributes: ['Material: 80% Cotton / 20% Polyester', 'Color: Heather Charcoal', 'Weight: Heavyweight fleece'],
      realisticBuyer: 'Spouse, child, or friend buying for a military history enthusiast.',
      realisticRecipient: 'Passionate Civil War buff, history teacher, or student.',
      giftRationale: 'Connects genuine intellectual interest in 19th-century history with high-comfort daily apparel.',
      relevantSearchIntents: ['civil war gifts', 'gifts for history buffs', 'history teacher hoodie'],
      differentiatingAttributes: ['Authentic 1863 cartography artwork', 'Comfortable heavyweight fleece', 'Unisex tailored fit'],
      titleStrategy: 'Prioritize Core Theme ("Civil War") and Primary Gift Intent ("Civil War Gift Hoodie") in the first 30 characters, followed by distinguishing 1863 Battle Map cartography.',
      titlePriorityOrder: [
        '1. Core Theme: American Civil War',
        '2. Primary Gift Intent: Civil War Gift',
        '3. Product Type: Hoodie',
        '4. Key Differentiator: 1863 Battle Map',
        '5. Material: Heavyweight Fleece',
      ],
      titleStrategyReasoning: 'Search queries for specialized history merchandise heavily favor the subject and gift intent combined (e.g. "civil war gifts"). Front-loading this sequence maximizes Google Shopping product matching.',
      descriptionStrategy: 'Describe historical significance of 1863 cartography, verified materials, and why it makes a lasting gift.',
      productTypeStrategy: 'Apparel > Hoodies > History Themed',
      customLabelsStrategy: {
        custom_label_0: 'History Buffs',
        custom_label_1: 'Premium Gifts ($40 - $75)',
        custom_label_2: 'Year-Round Essential',
        custom_label_3: 'American Civil War',
        custom_label_4: 'Hoodies & Sweatshirts',
      },
      antiRecommendations: [
        'Do not claim 100% organic cotton (verified as 80/20 blend)',
        'Do not generate fake GTIN numbers',
        'Avoid spam keywords like "Best cheap civil war gift ever"',
      ],
      googleCategoryRationale: 'Standard Google Product Category for Sweatshirts & Hoodies.',
      recommendedGoogleCategory: 'Apparel & Accessories > Clothing > Outerwear > Sweatshirts & Hoodies',
      researchedAt: now,
    },
    audit: {
      overallScore: 97,
      fieldScores: {
        accuracy: 99,
        searchRelevance: 98,
        giftRelevance: 98,
        taxonomy: 98,
        description: 95,
        naturalLanguage: 96,
        compliance: 99,
      },
      issues: [],
      warnings: [],
      criticalErrors: [],
      suggestedFixes: [],
      auditedAt: now,
    },
    validation: { isValid: true, blockingErrors: [], warnings: [] },
    originalImported: {
      title: 'Civil War Hoodie',
      price: '$49.99',
      description: 'Warm hoodie with Civil War map.',
    },
    appliedSuggestions: [
      { timestamp: now, fields: ['title', 'description', 'google_product_category', 'custom_labels'], note: 'Initial AI optimization accepted' },
    ],
    history: [
      { timestamp: now, note: 'Imported from URL', snapshot: { title: 'Civil War Hoodie' } },
      { timestamp: now, note: 'Applied Core Theme & Gift Intent Title Strategy', snapshot: { title: 'Civil War Gift Hoodie - 1863 Battle Map Heavyweight Fleece' } },
    ],
    createdAt: now,
    updatedAt: now,
  };

  const p2: ProductItem = {
    id: 'sog_gettysburg_1863_mug',
    productGroup: 'History',
    productSubgroup: 'Civil War',
    status: 'optimized',
    evidence: {
      sourceUrl: 'https://scienceofgifts.fourthwall.com/products/gettysburg-1863-coffee-mug',
      extractedAt: now,
      pageTitle: 'Battle of Gettysburg 1863 Ceramic Coffee Mug (15 oz)',
      rawDescription: 'Large 15 oz white glossy ceramic coffee mug featuring detailed topographical map of Gettysburg Day 1-3 maneuvers. Microwave and dishwasher safe.',
      verifiedAttributes: {
        brand: 'Science of Gifts',
        material: 'Ceramic',
        capacity: '15 oz',
        color: 'Glossy White',
        features: ['Microwave Safe', 'Dishwasher Safe', 'Lead and BPA-free'],
      },
      unresolvedAttributes: ['GTIN'],
      confidenceScores: { pageTitle: 1.0, material: 1.0, capacity: 1.0, price: 1.0 },
      variants: [
        { id: 'var_mug_11', title: '11 oz / White', price: '16.99 USD', capacity: '11 oz', available: true },
        { id: 'var_mug_15', title: '15 oz / White', price: '19.99 USD', capacity: '15 oz', available: true },
      ],
      images: [
        'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&auto=format&fit=crop&q=80',
      ],
      userCorrections: {},
    },
    merchantData: {
      id: 'sog_gettysburg_1863_mug',
      link: 'https://scienceofgifts.fourthwall.com/products/gettysburg-1863-coffee-mug',
      title: 'Battle of Gettysburg 1863 Gift Mug - Tactical Topography 15 oz Ceramic',
      description: 'Start every morning with a piece of tactical history. This 15 oz ceramic coffee mug from Science of Gifts displays the three-day battle maneuvers at Gettysburg with high-definition ceramic glaze. Made from durable, BPA-free white ceramic that is both microwave and dishwasher safe. A thoughtful and practical gift for history teachers, military veterans, and Civil War scholars.',
      image_link: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&auto=format&fit=crop&q=80',
      google_product_category: 'Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs',
      product_type: 'Home & Living > Drinkware > Ceramic Mugs',
      price: '19.99 USD',
      availability: 'in_stock',
      brand: 'Science of Gifts',
      gtin: '',
      mpn: '',
      identifier_exists: 'no',
      item_group_id: 'grp_sog_gettysburg_mug',
      color: 'White',
      size: '15 oz',
      material: 'Ceramic',
      gender: '',
      age_group: '',
      condition: 'new',
      custom_label_0: 'History Buffs',
      custom_label_1: 'Budget Gifts (< $20)',
      custom_label_2: 'Year-Round Essential',
      custom_label_3: 'American Civil War',
      custom_label_4: 'Drinkware > Mugs',
    },
    giftIntelligence: {
      theme: 'American Civil War',
      subtheme: 'Gettysburg',
      targetAudience: ['History Teachers', 'History Buffs', 'Coffee Drinkers'],
      recipientPersonas: ['History Teacher', 'Father / Grandfather', 'Historian'],
      occasions: ['Birthday', 'Teacher Appreciation', 'Christmas / Holidays'],
      primaryGiftIntent: 'gettysburg coffee mug',
      secondaryGiftIntents: ['civil war mug', 'history teacher mug', 'gifts for history buffs under 20'],
      searchConcepts: ['Gettysburg 1863', 'Ceramic Mug 15oz', 'Civil War Map', 'History Coffee Mug'],
    },
    titleCandidates: [
      {
        id: 'tc_mug_1',
        title: 'Battle of Gettysburg 1863 Gift Mug - Tactical Topography 15 oz Ceramic',
        formula: 'Core Theme + Primary Gift Intent + Product Type + Differentiator + Spec',
        titlePriorityOrder: [
          '1. Core Theme: Battle of Gettysburg 1863',
          '2. Primary Gift Intent: Gift Mug',
          '3. Differentiator: Tactical Topography',
          '4. Specs: 15 oz Ceramic',
        ],
        titleStrategyReasoning: 'Combines the specific battle subject with immediate gift mug intent and verified capacity (15 oz).',
        scores: {
          coreThemeProminence: 99,
          giftSearchRelevance: 98,
          productClarity: 97,
          naturalLanguage: 96,
          factualAccuracy: 99,
          differentiation: 96,
          characterEfficiency: 95,
          total: 97,
        },
        reasoning: 'Front loads historical event and gift intent, integrates verified 15 oz ceramic specs.',
      },
    ],
    selectedTitleCandidateId: 'tc_mug_1',
    strategy: {
      exactProductSummary: '15 oz glossy white ceramic coffee mug with Gettysburg tactical map.',
      dominantTheme: 'American Civil War',
      productCategory: 'Drinkware > Ceramic Mugs',
      verifiedPhysicalAttributes: ['Material: Ceramic', 'Capacity: 15 oz', 'Microwave & Dishwasher safe'],
      realisticBuyer: 'Colleague, student, or family member looking for an affordable thoughtful gift.',
      realisticRecipient: 'History teacher, professor, or civil war reader.',
      giftRationale: 'Affordable, useful daily desktop gift celebrating their favorite historical passion.',
      relevantSearchIntents: ['gettysburg gift', 'history teacher mug', 'civil war coffee mug'],
      differentiatingAttributes: ['Tactical battle line map', 'Large 15 oz capacity', 'Durable ceramic glaze'],
      titleStrategy: 'Front-load specific Battle subject (Battle of Gettysburg 1863), then Gift Mug intent, followed by tactical map differentiator and verified 15 oz capacity.',
      titlePriorityOrder: [
        '1. Core Theme: Battle of Gettysburg 1863',
        '2. Primary Gift Intent: Gift Mug',
        '3. Differentiator: Tactical Topography',
        '4. Specs: 15 oz Ceramic',
      ],
      titleStrategyReasoning: 'Combines high-volume search term "Gettysburg Gift" with exact physical mug specs.',
      descriptionStrategy: 'Detail the three-day battle map graphics, confirm dishwasher/microwave safety, and explain recipient appeal.',
      productTypeStrategy: 'Home & Living > Drinkware > Ceramic Mugs',
      customLabelsStrategy: {
        custom_label_0: 'History & Science Teachers',
        custom_label_1: 'Budget Gifts (< $20)',
        custom_label_2: 'Year-Round Essential',
        custom_label_3: 'American Civil War',
        custom_label_4: 'Drinkware > Mugs',
      },
      antiRecommendations: ['Do not label as thermal travel tumbler (it is a standard ceramic mug)'],
      googleCategoryRationale: 'Standard Google Product Category for Tableware > Drinkware > Mugs.',
      recommendedGoogleCategory: 'Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs',
      researchedAt: now,
    },
    audit: {
      overallScore: 98,
      fieldScores: {
        accuracy: 99,
        searchRelevance: 98,
        giftRelevance: 98,
        taxonomy: 99,
        description: 96,
        naturalLanguage: 96,
        compliance: 99,
      },
      issues: [],
      warnings: [],
      criticalErrors: [],
      suggestedFixes: [],
      auditedAt: now,
    },
    validation: { isValid: true, blockingErrors: [], warnings: [] },
    originalImported: {
      title: 'Gettysburg 1863 Mug',
      price: '$19.99',
    },
    appliedSuggestions: [],
    history: [{ timestamp: now, note: 'Initial Ingestion', snapshot: { title: 'Gettysburg 1863 Mug' } }],
    createdAt: now,
    updatedAt: now,
  };

  const p3: ProductItem = {
    id: 'sog_screenwriter_notebook',
    productGroup: 'TV & Film',
    productSubgroup: 'Filmmakers',
    status: 'needs_review',
    evidence: {
      sourceUrl: 'https://scienceofgifts.fourthwall.com/products/screenwriter-clapperboard-notebook',
      extractedAt: now,
      pageTitle: 'Screenwriter 35mm Clapperboard Hardcover Journal | Science of Gifts',
      rawDescription: 'Durable matte hardcover notebook with 128 dotted pages. Features iconic vintage film clapperboard design with slate scene/take prompts. 90gsm paper stock.',
      verifiedAttributes: {
        brand: 'Science of Gifts',
        material: 'Matte Hardcover with 90gsm Paper',
        dimensions: '5.2" x 7.3"',
        features: ['128 Dotted Pages', 'Lay-flat binding', 'Vintage 35mm Slate Art'],
      },
      unresolvedAttributes: ['GTIN'],
      confidenceScores: { pageTitle: 1.0, material: 0.95, price: 1.0 },
      variants: [],
      images: [
        'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&auto=format&fit=crop&q=80',
      ],
      userCorrections: {},
    },
    merchantData: {
      id: 'sog_screenwriter_notebook',
      link: 'https://scienceofgifts.fourthwall.com/products/screenwriter-clapperboard-notebook',
      title: 'Screenwriter Gift Journal - 35mm Clapperboard Matte Hardcover Notebook',
      description: 'Capture dialogue, screenplay notes, and storyboard sketches with this filmmaker-inspired hardcover notebook. Features vintage 35mm film slate artwork on a velvety matte cover, bound with 128 premium 90gsm dotted pages that prevent ink bleed. Perfect gift for indie directors, film students, screenwriters, and cinema aficionados.',
      image_link: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&auto=format&fit=crop&q=80',
      google_product_category: 'Office Supplies > Paper Products > Notebooks & Notepads',
      product_type: 'Stationery > Journals & Notebooks > Filmmaker Gifts',
      price: '22.00 USD',
      availability: 'in_stock',
      brand: 'Science of Gifts',
      gtin: '',
      mpn: '',
      identifier_exists: 'no',
      item_group_id: '',
      color: 'Matte Black',
      size: '5.2" x 7.3"',
      material: 'Matte Hardcover',
      gender: '',
      age_group: '',
      condition: 'new',
      custom_label_0: 'Filmmakers & Video Creators',
      custom_label_1: 'Mid-Tier Gifts ($20 - $40)',
      custom_label_2: 'Year-Round Essential',
      custom_label_3: 'Filmmaking & Cinema Arts',
      custom_label_4: 'Notebooks & Journals',
    },
    giftIntelligence: {
      theme: 'Filmmaking & Cinema Arts',
      subtheme: 'Screenwriting & Direction',
      targetAudience: ['Filmmakers & Video Creators', 'Writers & Novelists', 'Film Students'],
      recipientPersonas: ['Screenwriter', 'Director', 'Film Student'],
      occasions: ['Birthday', 'Graduation', 'Film Premiere / Wrap Gift', 'Christmas / Holidays'],
      primaryGiftIntent: 'gifts for screenwriters',
      secondaryGiftIntents: ['filmmaker notebook', 'director clapperboard journal', 'indie filmmaker gift'],
      searchConcepts: ['Screenplay Notebook', 'Clapperboard Journal', 'Filmmaking Gift'],
    },
    titleCandidates: [
      {
        id: 'tc_film_1',
        title: 'Screenwriter Gift Journal - 35mm Clapperboard Matte Hardcover Notebook',
        formula: 'Core Theme + Primary Gift Intent + Product Form Factor + Spec',
        titlePriorityOrder: [
          '1. Core Theme: Screenwriting & Cinema',
          '2. Primary Gift Intent: Screenwriter Gift Journal',
          '3. Differentiator: 35mm Vintage Clapperboard',
          '4. Specs: Matte Hardcover Dotted Notebook',
        ],
        titleStrategyReasoning: 'Front-loads the primary search intent ("Screenwriter Gift") and product form ("Journal"), followed by distinctive 35mm slate art and cover specs.',
        scores: {
          coreThemeProminence: 99,
          giftSearchRelevance: 98,
          productClarity: 96,
          naturalLanguage: 96,
          factualAccuracy: 99,
          differentiation: 96,
          characterEfficiency: 93,
          total: 97,
        },
        reasoning: 'Targets both screenwriter gift queries and film student search traffic with zero fluff.',
      },
    ],
    selectedTitleCandidateId: 'tc_film_1',
    strategy: {
      exactProductSummary: '5.2" x 7.3" matte hardcover journal with 128 dotted pages and 35mm film slate graphic.',
      dominantTheme: 'Filmmaking & Cinema Arts',
      productCategory: 'Stationery > Journals & Notebooks',
      verifiedPhysicalAttributes: ['Cover: Matte Hardcover', 'Pages: 128 Dotted Pages, 90gsm', 'Size: 5.2" x 7.3"'],
      realisticBuyer: 'Producer, director, film student peer, or proud family member.',
      realisticRecipient: 'Screenwriter, indie director, film student, or movie enthusiast.',
      giftRationale: 'Tactile, functional screenwriting accessory that validates the recipient’s creative craft.',
      relevantSearchIntents: ['gifts for screenwriters', 'filmmaker notebook', 'film student gift'],
      differentiatingAttributes: ['Authentic vintage clapperboard graphic', '90gsm ink-resistant dotted paper', 'Lay-flat binding'],
      titleStrategy: 'Front-load Core Theme & Gift Intent ("Screenwriter Gift Journal"), then highlight the 35mm clapperboard artwork and verified matte hardcover binding.',
      titlePriorityOrder: [
        '1. Core Theme: Screenwriting & Cinema',
        '2. Primary Gift Intent: Screenwriter Gift Journal',
        '3. Differentiator: 35mm Vintage Clapperboard',
        '4. Specs: Matte Hardcover Dotted Notebook',
      ],
      titleStrategyReasoning: 'Ensures immediate relevance for gift givers searching for screenwriting presents while communicating exact stationery specs.',
      descriptionStrategy: 'Highlight cover art, paper specs (90gsm dotted), lay-flat binding, and writer/director creative appeal.',
      productTypeStrategy: 'Stationery > Journals & Notebooks > Filmmaker Gifts',
      customLabelsStrategy: {
        custom_label_0: 'Filmmakers & Video Creators',
        custom_label_1: 'Mid-Tier Gifts ($20 - $40)',
        custom_label_2: 'Year-Round Essential',
        custom_label_3: 'Filmmaking & Cinema Arts',
        custom_label_4: 'Notebooks & Journals',
      },
      antiRecommendations: ['Do not claim leather bound (it is matte hardcover)'],
      googleCategoryRationale: 'Standard Google Product Category for Office Supplies > Paper Products > Notebooks & Notepads.',
      recommendedGoogleCategory: 'Office Supplies > Paper Products > Notebooks & Notepads',
      researchedAt: now,
    },
    audit: {
      overallScore: 94,
      fieldScores: {
        accuracy: 98,
        searchRelevance: 95,
        giftRelevance: 96,
        taxonomy: 97,
        description: 93,
        naturalLanguage: 95,
        compliance: 98,
      },
      issues: [],
      warnings: ['Product was updated recently. Verify custom label strategy before final export.'],
      criticalErrors: [],
      suggestedFixes: [],
      auditedAt: now,
    },
    validation: { isValid: true, blockingErrors: [], warnings: [] },
    originalImported: { title: 'Screenwriter Notebook' },
    appliedSuggestions: [],
    history: [{ timestamp: now, note: 'Imported from URL', snapshot: { title: 'Screenwriter Notebook' } }],
    createdAt: now,
    updatedAt: now,
  };

  const p4: ProductItem = {
    id: 'sog_spitfire_blueprint_poster',
    status: 'warnings',
    evidence: {
      sourceUrl: 'https://scienceofgifts.fourthwall.com/products/spitfire-mk-ix-blueprint-poster',
      extractedAt: now,
      pageTitle: 'Supermarine Spitfire Mk IX Technical Blueprint Poster',
      rawDescription: 'Museum-quality aviation blueprint print of the RAF Supermarine Spitfire Mk IX. Printed on archival 175gsm matte paper with pigment inks.',
      verifiedAttributes: {
        brand: 'Science of Gifts',
        material: '175gsm Archival Matte Paper',
        dimensions: '18" x 24"',
        features: ['Museum-grade Archival Paper', 'Pigment Inks', 'Rolled in protective tube'],
      },
      unresolvedAttributes: ['GTIN'],
      confidenceScores: { pageTitle: 1.0, material: 0.98, price: 1.0 },
      variants: [],
      images: [
        'https://images.unsplash.com/photo-1513151233558-d860c5398176?w=800&auto=format&fit=crop&q=80',
      ],
      userCorrections: {},
    },
    merchantData: {
      id: 'sog_spitfire_blueprint_poster',
      link: 'https://scienceofgifts.fourthwall.com/products/spitfire-mk-ix-blueprint-poster',
      title: 'WWII RAF Spitfire Mk IX Blueprint Poster (18x24) - Aviation History Gift',
      description: 'Detailed schematic blueprint of the legendary RAF Supermarine Spitfire Mk IX fighter aircraft. Printed with pigment inks on museum-grade 175gsm archival matte paper. Makes an exceptional statement piece for home offices, classrooms, and hangars.',
      image_link: 'https://images.unsplash.com/photo-1513151233558-d860c5398176?w=800&auto=format&fit=crop&q=80',
      google_product_category: '', // intentional warning for testing!
      product_type: 'Home Decor > Wall Art > Aviation Posters',
      price: '28.00 USD',
      availability: 'in_stock',
      brand: 'Science of Gifts',
      gtin: '',
      mpn: '',
      identifier_exists: 'no',
      item_group_id: '',
      color: 'Navy Blueprint',
      size: '18" x 24"',
      material: '175gsm Matte Paper',
      gender: '',
      age_group: '',
      condition: 'new',
      custom_label_0: 'History Buffs',
      custom_label_1: 'Mid-Tier Gifts ($20 - $40)',
      custom_label_2: 'Year-Round Essential',
      custom_label_3: 'World War II',
      custom_label_4: 'Wall Art & Posters',
    },
    giftIntelligence: {
      theme: 'World War II',
      subtheme: 'Aviation & Warbirds',
      targetAudience: ['History Buffs', 'Pilots & Aviation Nerds', 'Dads & Grandfathers'],
      recipientPersonas: ['Aviation Enthusiast', 'Grandfather', 'History Buff'],
      occasions: ['Father’s Day', 'Birthday', 'Christmas / Holidays'],
      primaryGiftIntent: 'spitfire blueprint poster',
      secondaryGiftIntents: ['wwii aviation gifts', 'airplane wall art', 'pilot gift'],
      searchConcepts: ['Spitfire Mk IX', 'RAF Blueprint', 'Aviation Poster'],
    },
    titleCandidates: [],
    validation: {
      isValid: true,
      blockingErrors: [],
      warnings: ['google_product_category is empty. Providing a standard Google category improves ad targeting.'],
    },
    originalImported: { title: 'Spitfire Poster' },
    appliedSuggestions: [],
    history: [{ timestamp: now, note: 'Initial Ingestion', snapshot: { title: 'Spitfire Poster' } }],
    createdAt: now,
    updatedAt: now,
  };

  return [p1, p2, p3, p4];
}

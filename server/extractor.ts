import { EvidenceModel, MerchantData, ProductItem, ProductVariant, VerifiedAttributes } from '../src/types/feed';
import { computeProductStatus } from '../src/utils/validation';
import { isValidColorName } from '../src/utils/attributeReconciler';

export async function extractProductFromUrl(url: string): Promise<ProductItem> {
  const now = new Date().toISOString();
  let html = '';
  let pageTitle = '';
  let rawDescription = '';
  let ogData: Record<string, string> = {};
  let jsonLd: any = null;
  let images: string[] = [];
  let variants: ProductVariant[] = [];
  let verifiedAttributes: VerifiedAttributes = {
    brand: 'Science of Gifts',
  };

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ScienceOfGiftsFeedBot/1.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      html = await response.text();
    }
  } catch (err: any) {
    console.warn(`[Extractor] Fetch error for ${url}:`, err.message);
  }

  // Parse HTML tags with Regex
  if (html) {
    // 1. Page Title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      pageTitle = decodeHtmlEntities(titleMatch[1].trim());
    }

    // 2. OpenGraph & Meta Tags
    const metaRegex = /<meta\s+([^>]+)>/gi;
    let metaMatch;
    while ((metaMatch = metaRegex.exec(html)) !== null) {
      const tag = metaMatch[1];
      const propMatch = tag.match(/(?:property|name)=["']([^"']+)["']/i);
      const contentMatch = tag.match(/content=["']([^"']*)["']/i);

      if (propMatch && contentMatch) {
        const key = propMatch[1].toLowerCase();
        const value = decodeHtmlEntities(contentMatch[1].trim());

        if (key.startsWith('og:') || key.startsWith('product:') || key === 'description') {
          ogData[key] = value;
        }
      }
    }

    // 3. JSON-LD scripts
    const jsonLdRegex = /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let jsonMatch;
    while ((jsonMatch = jsonLdRegex.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed['@type'] === 'Product' || (Array.isArray(parsed['@graph']) && parsed['@graph'].some((g: any) => g['@type'] === 'Product'))) {
          jsonLd = parsed['@type'] === 'Product' ? parsed : parsed['@graph'].find((g: any) => g['@type'] === 'Product');
          break;
        } else if (!jsonLd) {
          jsonLd = parsed;
        }
      } catch {
        // Ignore JSON-LD parse errors
      }
    }

    // 4. Look for Fourthwall or Shopify window state
    const stateRegex = /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});<\/script>/i;
    const stateMatch = html.match(stateRegex);
    if (stateMatch) {
      try {
        const stateObj = JSON.parse(stateMatch[1]);
        if (stateObj.product) {
          jsonLd = { ...jsonLd, fourthwallProduct: stateObj.product };
        }
      } catch {
        // ignore
      }
    }
  }

  // Synthesize extracted evidence
  const finalTitle =
    jsonLd?.name ||
    ogData['og:title'] ||
    pageTitle.replace(/[-|]\s*(Science of Gifts|Fourthwall|Shopify).*$/i, '').trim() ||
    extractSlugAsTitle(url);

  rawDescription =
    jsonLd?.description ||
    ogData['og:description'] ||
    ogData['description'] ||
    '';

  // Extract Images
  if (jsonLd?.image) {
    if (Array.isArray(jsonLd.image)) {
      images.push(...jsonLd.image.map((img: any) => (typeof img === 'string' ? img : img.url)));
    } else if (typeof jsonLd.image === 'string') {
      images.push(jsonLd.image);
    } else if (jsonLd.image?.url) {
      images.push(jsonLd.image.url);
    }
  }
  if (ogData['og:image'] && !images.includes(ogData['og:image'])) {
    images.push(ogData['og:image']);
  }

  // Extract Price & Currency
  let price = '$24.99';
  if (jsonLd?.offers) {
    const offer = Array.isArray(jsonLd.offers) ? jsonLd.offers[0] : jsonLd.offers;
    if (offer?.price) {
      const curr = offer.priceCurrency || 'USD';
      price = `${parseFloat(offer.price).toFixed(2)} ${curr}`;
    }
  } else if (ogData['og:price:amount'] || ogData['product:price:amount']) {
    const p = ogData['og:price:amount'] || ogData['product:price:amount'];
    const curr = ogData['og:price:currency'] || ogData['product:price:currency'] || 'USD';
    price = `${parseFloat(p).toFixed(2)} ${curr}`;
  }

  // 1. Extract Variants and Variant Attributes (Color & Size) from JSON-LD or State
  const extractedColors: string[] = [];
  const extractedSizes: string[] = [];

  if (jsonLd?.offers && Array.isArray(jsonLd.offers)) {
    variants = jsonLd.offers.map((off: any, idx: number) => {
      const varTitle = off.name || off.sku || `Variant ${idx + 1}`;
      const { color: vColor, size: vSize } = parseVariantAttributes(varTitle);

      const rawVarColor = off.color || vColor;
      const finalVarColor = rawVarColor && isValidColorName(rawVarColor) ? rawVarColor : undefined;
      const finalVarSize = off.size || vSize;

      if (finalVarColor && !extractedColors.includes(finalVarColor)) {
        extractedColors.push(finalVarColor);
      }
      if (finalVarSize && !extractedSizes.includes(finalVarSize)) {
        extractedSizes.push(finalVarSize);
      }

      return {
        id: off.sku || `var_${idx + 1}`,
        title: varTitle,
        price: off.price ? `${parseFloat(off.price).toFixed(2)} ${off.priceCurrency || 'USD'}` : price,
        sku: off.sku,
        color: finalVarColor || undefined,
        size: finalVarSize || undefined,
        available: off.availability ? !off.availability.includes('OutOfStock') : true,
      };
    });
  }

  // Check OpenGraph & JSON-LD root attributes
  if (ogData['product:color'] || ogData['og:product:color']) {
    const c = ogData['product:color'] || ogData['og:product:color'];
    if (c && isValidColorName(c) && !extractedColors.includes(c)) extractedColors.push(c);
  }
  if (jsonLd?.color && isValidColorName(jsonLd.color) && !extractedColors.includes(jsonLd.color)) {
    extractedColors.push(jsonLd.color);
  }

  if (ogData['product:material'] || ogData['og:product:material']) {
    const m = ogData['product:material'] || ogData['og:product:material'];
    if (m) verifiedAttributes.material = m;
  }
  if (jsonLd?.material) {
    verifiedAttributes.material = jsonLd.material;
  }

  // 2. Extract verified material / physical specs from description, title, or taxonomy (product-type aware)
  const descLower = (rawDescription + ' ' + finalTitle).toLowerCase();

  const isDrinkware =
    descLower.includes('mug') ||
    descLower.includes('cup') ||
    descLower.includes('drinkware') ||
    descLower.includes('glass') ||
    descLower.includes('tumbler') ||
    descLower.includes('whiskey') ||
    descLower.includes('shot glass') ||
    descLower.includes('stemless') ||
    descLower.includes('water bottle') ||
    descLower.includes('travel mug');

  const isFramed = descLower.includes('framed') || descLower.includes('frame');

  const isPoster =
    !isDrinkware &&
    (descLower.includes('poster') || descLower.includes('print') || descLower.includes('wall art') || descLower.includes('art print'));

  const isApparel =
    !isDrinkware && !isPoster &&
    (descLower.includes('hoodie') || descLower.includes('sweatshirt') || descLower.includes('t-shirt') || descLower.includes('shirt') || descLower.includes('tee') || descLower.includes('sweater') || descLower.includes('jacket') || descLower.includes('hat') || descLower.includes('cap') || descLower.includes('beanie'));

  if (!verifiedAttributes.material) {
    if (isDrinkware) {
      if (/\b(stainless\s*steel|stainless|18\/8|insulated\s*steel|metal\s*tumbler|steel)\b/i.test(descLower)) {
        verifiedAttributes.material = 'Stainless Steel';
      } else if (/\b(ceramic|porcelain|stoneware|clay)\b/i.test(descLower)) {
        verifiedAttributes.material = 'Ceramic';
      } else if (/\b(crystal)\b/i.test(descLower)) {
        verifiedAttributes.material = 'Crystal';
      } else if (/\b(glass|stemless\s*glass|pint\s*glass)\b/i.test(descLower)) {
        verifiedAttributes.material = 'Glass';
      } else if (descLower.includes('tumbler') || descLower.includes('travel mug') || descLower.includes('water bottle')) {
        verifiedAttributes.material = 'Stainless Steel';
      } else if (descLower.includes('mug') || descLower.includes('coffee cup')) {
        verifiedAttributes.material = 'Ceramic';
      }
      // Otherwise, leave verifiedAttributes.material empty rather than guessing incorrectly
    } else if (isPoster) {
      if (isFramed) {
        if (descLower.includes('wood') || descLower.includes('wooden')) verifiedAttributes.material = 'Museum-grade Matte Paper with Wood Frame';
        else if (descLower.includes('metal')) verifiedAttributes.material = 'Museum-grade Matte Paper with Metal Frame';
        else verifiedAttributes.material = 'Museum-grade Matte Paper with Frame';
      } else if (descLower.includes('canvas')) {
        verifiedAttributes.material = 'Canvas';
      } else {
        verifiedAttributes.material = 'Museum-grade Matte Paper';
      }
    } else if (isApparel) {
      if (/\b(100%\s*polyester|high-quality polyester|durable polyester|polyester fabric|100%\s*poly)\b/i.test(descLower)) {
        verifiedAttributes.material = 'Polyester';
      } else if (/\b(cotton\s*\/\s*polyester blend|cotton blend|poly\/cotton|cotton-poly|polyester blend|fleece)\b/i.test(descLower)) {
        verifiedAttributes.material = 'Cotton / Polyester Blend';
      } else if (/\bpolyester\b/i.test(descLower) && !/\bcotton\b/i.test(descLower)) {
        verifiedAttributes.material = 'Polyester';
      } else if (/\b(100%\s*cotton|ring-spun cotton|combed cotton|pure cotton|heavy cotton)\b/i.test(descLower)) {
        verifiedAttributes.material = '100% Cotton';
      } else if (/\b(cotton twill|twill)\b/i.test(descLower) || (/\b(baseball cap|dad cap|trucker cap|bucket hat)\b/i.test(descLower) && /\b(twill|cotton)\b/i.test(descLower))) {
        verifiedAttributes.material = '100% Cotton Twill';
      } else if (/\bcotton\b/i.test(descLower)) {
        verifiedAttributes.material = '100% Cotton';
      }
    } else {
      if (descLower.includes('100% cotton')) verifiedAttributes.material = '100% Cotton';
      else if (descLower.includes('ceramic')) verifiedAttributes.material = 'Ceramic';
      else if (descLower.includes('canvas')) verifiedAttributes.material = 'Canvas';
    }
  }

  // Capacity detection
  if (descLower.includes('11 oz')) verifiedAttributes.capacity = '11 oz';
  if (descLower.includes('15 oz')) verifiedAttributes.capacity = '15 oz';

  // 3. Extract verified color & size attributes
  const validExtractedColors = extractedColors.filter(isValidColorName);
  if (validExtractedColors.length > 0) {
    verifiedAttributes.color = validExtractedColors[0];
  } else {
    const textColor = detectColorFromText(finalTitle + ' ' + rawDescription);
    if (textColor && isValidColorName(textColor)) {
      verifiedAttributes.color = textColor;
    }
  }

  if (extractedSizes.length > 0) {
    verifiedAttributes.size = extractedSizes.length === 1
      ? extractedSizes[0]
      : extractedSizes.length > 3
        ? `${extractedSizes[0]} - ${extractedSizes[extractedSizes.length - 1]}`
        : extractedSizes.join(', ');
  } else {
    const textSize = detectSizeFromText(finalTitle + ' ' + rawDescription);
    if (textSize) {
      verifiedAttributes.size = textSize;
    }
  }

  if (jsonLd?.brand?.name) {
    verifiedAttributes.brand = jsonLd.brand.name;
  }
  if (jsonLd?.gtin || jsonLd?.gtin13 || jsonLd?.gtin12) {
    verifiedAttributes.gtin = jsonLd.gtin || jsonLd.gtin13 || jsonLd.gtin12;
  }
  if (jsonLd?.mpn) {
    verifiedAttributes.mpn = jsonLd.mpn;
  }
  if (jsonLd?.sku) {
    verifiedAttributes.sku = jsonLd.sku;
  }

  // Determine standard Google Product Category & Product Type candidates
  const { gpc, productType, gender, ageGroup } = guessTaxonomy(finalTitle, rawDescription);

  const productId = extractProductId(url, jsonLd?.sku);

  const merchantData: MerchantData = {
    id: productId,
    link: url,
    title: finalTitle,
    description: rawDescription || `Authentic Science of Gifts design featuring ${finalTitle}. Printed on premium durable materials.`,
    image_link: images[0] || 'https://placehold.co/600x600/1e293b/ffffff?text=Science+of+Gifts',
    additional_image_link: images[1] || '',
    google_product_category: gpc,
    product_type: productType,
    price: price,
    availability: 'in_stock',
    brand: verifiedAttributes.brand || 'Science of Gifts',
    gtin: verifiedAttributes.gtin || '',
    mpn: verifiedAttributes.mpn || '',
    identifier_exists: verifiedAttributes.gtin || verifiedAttributes.mpn ? 'yes' : 'no',
    item_group_id: variants.length > 1 ? productId : '',
    color: verifiedAttributes.color || '',
    size: verifiedAttributes.size || '',
    material: verifiedAttributes.material || '',
    gender: gender as any,
    age_group: ageGroup as any,
    condition: 'new',
    custom_label_0: '',
    custom_label_1: '',
    custom_label_2: 'Year-Round Essential',
    custom_label_3: '',
    custom_label_4: productType.split('>').pop()?.trim() || '',
  };

  const evidence: EvidenceModel = {
    sourceUrl: url,
    extractedAt: now,
    pageTitle: pageTitle || finalTitle,
    rawDescription,
    jsonLd: jsonLd || undefined,
    openGraph: ogData,
    verifiedAttributes,
    unresolvedAttributes: ['GTIN / MPN (Not provided in source page)', 'Care instructions'],
    confidenceScores: {
      pageTitle: pageTitle ? 0.95 : 0.7,
      price: price ? 0.95 : 0.6,
      images: images.length > 0 ? 0.98 : 0.5,
      material: verifiedAttributes.material ? 0.9 : 0.2,
    },
    variants,
    images,
    userCorrections: {},
  };

  const giftIntelligence = {
    theme: '',
    subtheme: '',
    targetAudience: [],
    recipientPersonas: [],
    occasions: [],
    primaryGiftIntent: '',
    secondaryGiftIntents: [],
    searchConcepts: [],
  };

  const inferredGroup = inferProductGroupAndSubgroup(finalTitle, rawDescription, url);

  const product: ProductItem = {
    id: productId,
    productGroup: inferredGroup.productGroup,
    productSubgroup: inferredGroup.productSubgroup,
    status: 'not_analyzed',
    evidence,
    merchantData,
    giftIntelligence,
    titleCandidates: [],
    originalImported: { ...merchantData },
    appliedSuggestions: [],
    history: [
      {
        timestamp: now,
        note: 'Extracted from source URL',
        snapshot: { ...merchantData },
      },
    ],
    validation: { isValid: true, blockingErrors: [], warnings: [] },
    createdAt: now,
    updatedAt: now,
  };

  const { status, validation } = computeProductStatus(product);
  product.status = status;
  product.validation = validation;

  return product;
}

// Helper to infer product group and subgroup from product title, description, and URL
export function inferProductGroupAndSubgroup(
  title: string,
  desc: string,
  url: string = ''
): { productGroup: string; productSubgroup: string } {
  const text = `${title} ${desc} ${url}`.toLowerCase();

  // 1. Detect TV & Film (including How I Met Your Mother & Sitcoms)
  const isHIMYM =
    text.includes('how i met your mother') ||
    text.includes('himym') ||
    text.includes('barney stinson') ||
    text.includes('ted mosby') ||
    text.includes('robin scherbatsky') ||
    text.includes('robin sparkles') ||
    text.includes('marshall eriksen') ||
    text.includes('lily aldrin') ||
    text.includes('maclaren') ||
    text.includes('suit up') ||
    text.includes('yellow umbrella') ||
    text.includes('blue french horn') ||
    text.includes('the playbook') ||
    text.includes('slapsgiving') ||
    text.includes('ducky tie') ||
    text.includes('duck tie') ||
    text.includes('goliath national bank') ||
    text.includes('puzzles the bar');

  if (isHIMYM) {
    return { productGroup: 'TV & Film', productSubgroup: 'How I Met Your Mother' };
  }

  const isFilmTv =
    text.includes('screenwriter') ||
    text.includes('cinematography') ||
    text.includes('clapperboard') ||
    text.includes('filmmaker') ||
    text.includes('filmmaking') ||
    text.includes('movie director') ||
    text.includes('cinema') ||
    text.includes('sitcom') ||
    text.includes('television series') ||
    text.includes('tv show');

  if (isFilmTv) {
    return { productGroup: 'TV & Film', productSubgroup: 'Filmmakers' };
  }

  // 2. Detect Music
  const isJazz = text.includes('jazz') || text.includes('miles davis') || text.includes('coltrane') || text.includes('thelonious');
  if (isJazz) {
    return { productGroup: 'Music', productSubgroup: 'Jazz' };
  }
  const isClassicalMusic = text.includes('classical music') || text.includes('beethoven') || text.includes('mozart') || text.includes('bach') || text.includes('symphony') || text.includes('orchestra') || text.includes('composer');
  if (isClassicalMusic) {
    return { productGroup: 'Music', productSubgroup: 'Classical Music' };
  }
  const isMusicGeneral = text.includes('rock & vinyl') || text.includes('vinyl record') || text.includes('guitarist') || text.includes('pianist');
  if (isMusicGeneral) {
    return { productGroup: 'Music', productSubgroup: 'Rock & Vinyl' };
  }

  // 3. Detect Professions
  if (text.includes('history teacher') || text.includes('english teacher') || text.includes('professor') || text.includes('math teacher') || text.includes('science teacher')) {
    return { productGroup: 'Professions', productSubgroup: 'Teachers' };
  }
  if (text.includes('pilot') || text.includes('aviator') || text.includes('flight crew') || text.includes('first officer')) {
    return { productGroup: 'Professions', productSubgroup: 'Pilots' };
  }
  if (text.includes('police officer') || text.includes('law enforcement') || text.includes('sheriff')) {
    return { productGroup: 'Professions', productSubgroup: 'Police' };
  }
  if (text.includes('engineer') || text.includes('software engineer')) {
    return { productGroup: 'Professions', productSubgroup: 'Engineers' };
  }
  if (text.includes('nurse') || text.includes('nursing')) {
    return { productGroup: 'Professions', productSubgroup: 'Nurses' };
  }

  // 4. Detect Vikings & Norse Mythology (with comprehensive Norse keywords)
  const isViking =
    text.includes('viking') ||
    text.includes('norse') ||
    text.includes('valhalla') ||
    text.includes('thor') ||
    text.includes('odin') ||
    text.includes('asgard') ||
    text.includes('runes') ||
    text.includes('shieldmaiden') ||
    text.includes('yggdrasil') ||
    text.includes('ragnarok') ||
    text.includes('midgard') ||
    text.includes('fenrir') ||
    text.includes('valkyrie') ||
    text.includes('drakkar') ||
    text.includes('longship') ||
    text.includes('berserker') ||
    text.includes('freya') ||
    text.includes('loki');

  if (isViking) {
    return { productGroup: 'History', productSubgroup: 'Vikings' };
  }

  // 5. Specific History Subgroups
  if (text.includes('wwii') || text.includes('world war ii') || text.includes('spitfire') || text.includes('b-17') || text.includes('warbird') || text.includes('d-day') || text.includes('churchill') || text.includes('pearl harbor')) {
    return { productGroup: 'History', productSubgroup: 'WWII' };
  }
  if (text.includes('civil war') || text.includes('gettysburg') || text.includes('1861') || text.includes('1863') || text.includes('1865') || text.includes('confederate') || text.includes('union army') || text.includes('robert e lee') || text.includes('ulysses s grant')) {
    return { productGroup: 'History', productSubgroup: 'Civil War' };
  }
  if (text.includes('american revolution') || text.includes('1776') || text.includes('founding fathers') || text.includes('george washington') || text.includes('declaration of independence')) {
    return { productGroup: 'History', productSubgroup: 'American Revolution' };
  }
  if (text.includes('lincoln') || text.includes('gettysburg address') || text.includes('abraham lincoln') || text.includes('emancipation proclamation')) {
    return { productGroup: 'History', productSubgroup: 'Abraham Lincoln' };
  }

  // AGGRESSIVE FILTER: Ensure that known non-historical themes (TV & Film, Sitcoms, Music, Pop Culture)
  // are never assigned to the "History" group fallback even if the word "history", "historical", or "archival" appears in passing.
  const hasNonHistoricalContext =
    text.includes('sitcom') ||
    text.includes('movie') ||
    text.includes('film') ||
    text.includes('tv') ||
    text.includes('television') ||
    text.includes('show') ||
    text.includes('actor') ||
    text.includes('actress') ||
    text.includes('music') ||
    text.includes('song') ||
    text.includes('album') ||
    text.includes('band') ||
    text.includes('comedy') ||
    text.includes('pop culture');

  if (!hasNonHistoricalContext && (text.includes('history') || text.includes('historian') || text.includes('archival') || text.includes('historical') || text.includes('ancient') || text.includes('century') || text.includes('warfare'))) {
    return { productGroup: 'History', productSubgroup: 'General History' };
  }

  if (hasNonHistoricalContext) {
    if (text.includes('music') || text.includes('song') || text.includes('band')) {
      return { productGroup: 'Music', productSubgroup: 'Rock & Vinyl' };
    }
    return { productGroup: 'TV & Film', productSubgroup: 'Film' };
  }

  return { productGroup: 'Other', productSubgroup: 'General Gifts' };
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function extractSlugAsTitle(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split('/').filter(Boolean).pop() || 'product';
    return lastSegment
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return 'Science of Gifts Product';
  }
}

function extractProductId(url: string, sku?: string): string {
  if (sku) return sku;
  try {
    const parsed = new URL(url);
    const slug = parsed.pathname.split('/').filter(Boolean).pop() || 'item';
    return `sog_${slug.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`;
  } catch {
    return `sog_${Date.now()}`;
  }
}

export function guessTaxonomy(title: string, desc: string): {
  gpc: string;
  productType: string;
  gender: string;
  ageGroup: string;
} {
  const combined = (title + ' ' + desc).toLowerCase();

  if (combined.includes('hoodie') || combined.includes('sweatshirt')) {
    return {
      gpc: 'Apparel & Accessories > Clothing > Outerwear > Sweatshirts & Hoodies',
      productType: 'Apparel > Hoodies & Sweatshirts',
      gender: 'unisex',
      ageGroup: 'adult',
    };
  }
  if (combined.includes('shirt') || combined.includes('tee') || combined.includes('t-shirt')) {
    return {
      gpc: 'Apparel & Accessories > Clothing > Shirts & Tops',
      productType: 'Apparel > T-Shirts & Tops',
      gender: 'unisex',
      ageGroup: 'adult',
    };
  }
  if (combined.includes('mug') || combined.includes('coffee mug') || combined.includes('cup')) {
    return {
      gpc: 'Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs',
      productType: 'Home & Living > Drinkware > Ceramic Mugs',
      gender: '',
      ageGroup: '',
    };
  }
  if (combined.includes('poster') || combined.includes('print') || combined.includes('wall art')) {
    return {
      gpc: 'Home & Garden > Decor > Artwork > Posters, Prints & Visual Artwork',
      productType: 'Home Decor > Wall Art > Historical Posters',
      gender: '',
      ageGroup: '',
    };
  }
  if (combined.includes('notebook') || combined.includes('journal') || combined.includes('diary')) {
    return {
      gpc: 'Office Supplies > Paper Products > Notebooks & Notepads',
      productType: 'Stationery > Journals & Notebooks',
      gender: '',
      ageGroup: '',
    };
  }
  if (combined.includes('cap') || combined.includes('hat') || combined.includes('beanie')) {
    return {
      gpc: 'Apparel & Accessories > Clothing Accessories > Hats',
      productType: 'Apparel > Headwear > Embroidered Caps',
      gender: 'unisex',
      ageGroup: 'adult',
    };
  }
  if (combined.includes('tote') || combined.includes('bag')) {
    return {
      gpc: 'Luggage & Bags > Shopping Totes',
      productType: 'Accessories > Bags > Canvas Totes',
      gender: 'unisex',
      ageGroup: 'adult',
    };
  }

  return {
    gpc: '',
    productType: '',
    gender: '',
    ageGroup: '',
  };
}

function parseVariantAttributes(title: string): { color?: string; size?: string } {
  let color = '';
  let size = '';
  const parts = title.split(/[,/|-]/).map((p) => p.trim()).filter(Boolean);

  for (const part of parts) {
    const isSize =
      /^(xs|s|m|l|xl|2xl|3xl|4xl|5xl|small|medium|large|x-large|xx-large|one size|os)$/i.test(part) ||
      /\d+(\.\d+)?\s*(?:"|in|inch|inches|cm|mm)?\s*x\s*\d+(\.\d+)?/i.test(part) ||
      /\d+\s*(oz|ml|l|ounce|ounces)/i.test(part);

    if (isSize) {
      if (!size) size = part;
    } else {
      if (!color && isValidColorName(part)) {
        color = part;
      }
    }
  }
  return { color: color || undefined, size: size || undefined };
}

function detectColorFromText(text: string): string | undefined {
  const lower = text.toLowerCase();
  const knownColors = [
    { name: 'Heather Charcoal', regex: /\bheather charcoal\b/i },
    { name: 'Black', regex: /\b(black|monochrome|black-and-white|black & white)\b/i },
    { name: 'White', regex: /\b(white|glossy white)\b/i },
    { name: 'Navy', regex: /\b(navy|navy blue)\b/i },
    { name: 'Charcoal', regex: /\bcharcoal\b/i },
    { name: 'Sport Grey', regex: /\bsport gre?y\b/i },
    { name: 'Red', regex: /\bred\b/i },
    { name: 'Maroon', regex: /\bmaroon\b/i },
    { name: 'Natural', regex: /\b(natural|cream|off-white)\b/i },
    { name: 'Royal Blue', regex: /\broyal blue\b/i },
  ];

  for (const item of knownColors) {
    if (item.regex.test(lower)) return item.name;
  }
  return undefined;
}

function detectSizeFromText(text: string): string | undefined {
  const dimMatch = text.match(/\b\d+(\.\d+)?\s*(?:"|in|inch|inches)?\s*x\s*\d+(\.\d+)?\s*(?:"|in|inch|inches)?\b/i);
  if (dimMatch) return dimMatch[0];

  const capMatch = text.match(/\b(11|15|12|16|20|32)\s*oz\b/i);
  if (capMatch) return capMatch[0];

  const sizeMatch = text.match(/\b(S - 3XL|S-3XL|S to 2XL|XS|S|M|L|XL|2XL|3XL)\b/i);
  if (sizeMatch) return sizeMatch[0];

  return undefined;
}

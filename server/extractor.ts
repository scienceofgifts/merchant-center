import { EvidenceModel, MerchantData, ProductItem, ProductVariant, VerifiedAttributes } from '../src/types/feed';
import { computeProductStatus } from '../src/utils/validation';

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

  // Extract verified material / physical specs from description or JSON-LD
  const descLower = (rawDescription + ' ' + finalTitle).toLowerCase();
  if (descLower.includes('100% cotton') || descLower.includes('ring-spun cotton')) {
    verifiedAttributes.material = '100% Cotton';
  } else if (descLower.includes('cotton blend') || descLower.includes('poly/cotton') || descLower.includes('polyester')) {
    verifiedAttributes.material = 'Cotton / Polyester Blend';
  } else if (descLower.includes('ceramic') || descLower.includes('11 oz') || descLower.includes('15 oz')) {
    verifiedAttributes.material = 'Ceramic';
    if (descLower.includes('11 oz')) verifiedAttributes.capacity = '11 oz';
    if (descLower.includes('15 oz')) verifiedAttributes.capacity = '15 oz';
  } else if (descLower.includes('canvas') || descLower.includes('museum-grade paper') || descLower.includes('matte paper')) {
    verifiedAttributes.material = 'Museum-grade Matte Paper';
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

  // Extract Variants if present
  if (jsonLd?.offers && Array.isArray(jsonLd.offers)) {
    variants = jsonLd.offers.map((off: any, idx: number) => ({
      id: off.sku || `var_${idx + 1}`,
      title: off.name || off.sku || `Variant ${idx + 1}`,
      price: off.price ? `${parseFloat(off.price).toFixed(2)} ${off.priceCurrency || 'USD'}` : price,
      sku: off.sku,
      available: off.availability ? !off.availability.includes('OutOfStock') : true,
    }));
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

  const product: ProductItem = {
    id: productId,
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

function guessTaxonomy(title: string, desc: string): {
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
    gpc: 'Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs',
    productType: 'Gifts & Collectibles > Themed Merchandise',
    gender: '',
    ageGroup: '',
  };
}

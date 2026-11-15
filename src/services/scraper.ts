import * as cheerio from 'cheerio';
import axios from 'axios';

export interface ScrapedProduct {
  name: string;
  price: number;
  currency: string;
  imageUrl?: string;
  description?: string;
}

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Baixa a página e extrai os dados do produto. Retorna null em qualquer falha. */
export async function scrapeProduct(url: string): Promise<ScrapedProduct | null> {
  try {
    const response = await axios.get<string>(url, {
      responseType: 'text',
      maxContentLength: 2_000_000,
      timeout: 15_000,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    return extractProduct(response.data ?? '');
  } catch {
    return null;
  }
}

/** Converte strings de preço em número: aceita "R$ 1.234,56", "$1,234.56", "1.234" (milhar), etc. */
export function parsePrice(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,]/g, '');
  if (!/\d/.test(cleaned)) return null;

  let normalized: string;

  if (cleaned.includes('.') && cleaned.includes(',')) {
    // último separador é o decimal; o outro é separador de milhar
    const decimalSep = cleaned.lastIndexOf('.') > cleaned.lastIndexOf(',') ? '.' : ',';
    const thousandSep = decimalSep === '.' ? ',' : '.';
    normalized = cleaned.split(thousandSep).join('').replace(decimalSep, '.');
  } else if (cleaned.includes('.') || cleaned.includes(',')) {
    const sep = cleaned.includes('.') ? '.' : ',';
    // `\d{1,3}(sep\d{3})+` => separador de milhar sem decimais (preços não têm 3 casas decimais)
    const thousandPattern = new RegExp(`^\\d{1,3}(${sep === '.' ? '\\.' : '\\,'}\\d{3})+$`);
    if (thousandPattern.test(cleaned)) {
      normalized = cleaned.split(sep).join('');
    } else {
      normalized = cleaned.replace(sep === ',' ? ',' : '.', '.');
    }
  } else {
    normalized = cleaned;
  }

  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Extrai dados de produto de uma página HTML já baixada.
 * Estratégias em cascata (primeira que produza name + price vence):
 * 1. JSON-LD (Schema.org Product)
 * 2. Meta tags (itemprop=price / og:price:amount / product:price:amount)
 * 3. Heurística CSS (data-price, classes *price*, regex de R$ no texto)
 */
export function extractProduct(html: string): ScrapedProduct | null {
  const $ = cheerio.load(html);
  return fromJsonLd($) ?? fromMeta($) ?? fromHeuristics($, html);
}

// ---------------------------------------------------------------------------
// Estratégia 1: JSON-LD
// ---------------------------------------------------------------------------

function findProductNodes(node: unknown, acc: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const item of node) findProductNodes(item, acc);
  } else if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
    if (types.some((t) => typeof t === 'string' && t.toLowerCase() === 'product')) {
      acc.push(obj);
    }
    for (const value of Object.values(obj)) findProductNodes(value, acc);
  }
  return acc;
}

function fromJsonLd($: cheerio.CheerioAPI): ScrapedProduct | null {
  for (const script of $('script[type="application/ld+json"]').get()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse($(script).text());
    } catch {
      continue;
    }

    for (const node of findProductNodes(parsed)) {
      const offers = node.offers;
      for (const offer of Array.isArray(offers) ? offers : [offers]) {
        if (!offer || typeof offer !== 'object') continue;
        const o = offer as Record<string, unknown>;
        const price = typeof o.price === 'number' ? o.price : parsePrice(String(o.price ?? ''));
        if (!price) continue;

        const imageUrl = Array.isArray(node.image) ? node.image[0] : node.image;
        return {
          name: String(node.name ?? '').trim(),
          price,
          currency: String(o.priceCurrency ?? '').trim() || 'BRL',
          imageUrl: typeof imageUrl === 'string' ? imageUrl : undefined,
          description: typeof node.description === 'string' ? node.description : undefined,
        };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Estratégia 2: meta tags / itemprop
// ---------------------------------------------------------------------------

function fromMeta($: cheerio.CheerioAPI): ScrapedProduct | null {
  const priceSelectors = [
    'meta[itemprop="price"]',
    '[itemprop="price"]',
    'meta[property="og:price:amount"]',
    'meta[property="product:price:amount"]',
  ];

  for (const selector of priceSelectors) {
    for (const el of $(selector).get()) {
      const raw = $(el).attr('content') ?? $(el).text();
      const price = parsePrice(raw);
      if (!price) continue;

      const currencyRaw =
        $('meta[property="product:price:currency"]').attr('content') ??
        $('meta[property="og:price:currency"]').attr('content') ??
        $('meta[itemprop="priceCurrency"]').attr('content') ??
        '';
      const currency = currencyRaw.trim().slice(0, 3).toUpperCase();

      return {
        name: $('meta[property="og:title"]').attr('content')?.trim() ?? $('title').text().trim(),
        price,
        currency: currency || detectCurrency(htmlForDetection($)),
        imageUrl: $('meta[property="og:image"]').attr('content') ?? undefined,
        description:
          $('meta[property="og:description"]').attr('content') ??
          $('meta[name="description"]').attr('content') ??
          undefined,
      };
    }
  }
  return null;
}

function htmlForDetection($: cheerio.CheerioAPI): string {
  return $('head').html() ?? '';
}

// ---------------------------------------------------------------------------
// Estratégia 3: heurística CSS
// ---------------------------------------------------------------------------

const CURRENCY_PATTERNS: [RegExp, string][] = [
  [/R\$/, 'BRL'],
  [/€/, 'EUR'],
  [/US?\$/, 'USD'],
];

function detectCurrency(text: string): string {
  for (const [pattern, currency] of CURRENCY_PATTERNS) {
    if (pattern.test(text)) return currency;
  }
  return 'BRL';
}

function fromHeuristics($: cheerio.CheerioAPI, html: string): ScrapedProduct | null {
  const name = $('meta[property="og:title"]').attr('content')?.trim() || $('title').text().trim();
  const imageUrl = $('meta[property="og:image"]').attr('content') ?? undefined;
  const currency = detectCurrency(html);

  // 1) atributo data-price
  for (const el of $('[data-price]').get()) {
    const price = parsePrice($(el).attr('data-price'));
    if (price) return buildResult(name, price, currency, imageUrl);
  }

  // 2) texto de elementos com "price" na classe (varre todos: o primeiro match com R$ pode ser preço antigo)
  for (const el of $('[class*="price"]').get()) {
    const price = parsePrice($(el).text());
    if (price) return buildResult(name, price, currency, imageUrl);
  }

  // 3) regex de moeda no texto da página
  const bodyText = $('script').remove().end().find('body').text();
  for (const pattern of [ /R\$\s*[\d.,]+/, /€\s?[\d.,]+/, /US?\$\s?[\d.,]+/ ]) {
    const match = bodyText.match(pattern);
    if (!match) continue;
    const price = parsePrice(match[0]);
    if (price) return buildResult(name, price, detectCurrency(match[0]), imageUrl);
  }

  return null;
}

function buildResult(
  name: string,
  price: number,
  currency: string,
  imageUrl?: string,
): ScrapedProduct | null {
  if (!price || !name) return null;
  return {
    name,
    price,
    currency,
    imageUrl,
    description: undefined,
  };
}

import type { FastifyBaseLogger } from 'fastify';
import { pool } from '../db/connection.js';
import { scrapeProduct } from '../services/scraper.js';
import { notifyPriceDrop } from '../services/notifier.js';

export const MAX_CONSECUTIVE_FAILURES = 5;
export const CHECK_INTERVAL = '24 hours';

export interface ProductSnapshot {
  id: string;
  user_id: string;
  source_url: string;
  name: string;
  currency: string;
  current_price: number;
  scrape_failures: number;
}

export type PriceDecision =
  | { action: 'record-drop'; newPrice: number } // queda: histórico + push
  | { action: 'record-rise'; newPrice: number } // alta: histórico, sem push
  | { action: 'unchanged' }                     // só atualiza last_checked_at
  | { action: 'scrape-failed'; unavailable: boolean };

/** Função pura: decide o que fazer com um produto dado o preço raspado (ou null na falha). */
export function decidePriceCheck(
  scrapedPrice: number | null,
  product: ProductSnapshot,
): PriceDecision {
  if (scrapedPrice === null) {
    return {
      action: 'scrape-failed',
      unavailable: product.scrape_failures + 1 >= MAX_CONSECUTIVE_FAILURES,
    };
  }
  if (scrapedPrice < product.current_price) {
    return { action: 'record-drop', newPrice: scrapedPrice };
  }
  if (scrapedPrice > product.current_price) {
    return { action: 'record-rise', newPrice: scrapedPrice };
  }
  return { action: 'unchanged' };
}

export interface RunSummary {
  checked: number;
  drops: number;
  rises: number;
  failures: number;
  unavailableMarked: number;
}

/** Um ciclo do cron: processa todos os produtos com last_checked_at >= 24h (ou NULL). */
export async function runPriceCheck(log?: FastifyBaseLogger): Promise<RunSummary> {
  const { rows } = await pool.query<{
    id: string;
    user_id: string;
    source_url: string;
    name: string;
    currency: string;
    current_price: string;
    scrape_failures: number;
  }>(
    `SELECT id, user_id, source_url, name, currency, current_price, scrape_failures
       FROM products
      WHERE unavailable = FALSE
        AND (last_checked_at IS NULL OR last_checked_at < NOW() - INTERVAL '${CHECK_INTERVAL}')`,
  );

  const summary: RunSummary = {
    checked: 0,
    drops: 0,
    rises: 0,
    failures: 0,
    unavailableMarked: 0,
  };

  for (const row of rows) {
    summary.checked++;
    const product: ProductSnapshot = {
      ...row,
      current_price: Number(row.current_price),
    };

    const scraped = await scrapeProduct(product.source_url);
    const decision = decidePriceCheck(scraped?.price ?? null, product);

    switch (decision.action) {
      case 'unchanged': {
        log?.info({ product_id: product.id }, 'price check: preço inalterado');
        await pool.query(
          `UPDATE products
              SET last_checked_at = NOW(), scrape_failures = 0
            WHERE id = $1`,
          [product.id],
        );
        break;
      }

      case 'record-drop':
      case 'record-rise': {
        log?.info({ product_id: product.id, new_price: decision.newPrice }, `price check: ${decision.action}`);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            'INSERT INTO price_history (product_id, price) VALUES ($1, $2)',
            [product.id, decision.newPrice],
          );
          await client.query(
            `UPDATE products
                SET current_price = $2, last_checked_at = NOW(), scrape_failures = 0
              WHERE id = $1`,
            [product.id, decision.newPrice],
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
        if (decision.action === 'record-drop') {
          summary.drops++;
          await notifyPriceDrop(product.user_id, {
            name: product.name,
            price: decision.newPrice,
            currency: product.currency,
          });
        } else {
          summary.rises++;
        }
        break;
      }

      case 'scrape-failed': {
        summary.failures++;
        if (decision.unavailable) {
          summary.unavailableMarked++;
          log?.warn({ product_id: product.id }, 'price check: produto marcado como unavailable');
        } else {
          log?.warn({ product_id: product.id }, 'price check: falha no scraping');
        }
        // last_checked_at NÃO avança (spec) — produto será tentado de novo no próximo ciclo
        // (a menos que tenha virado unavailable, que já fica fora da query)
        await pool.query(
          `UPDATE products
              SET scrape_failures = scrape_failures + 1, unavailable = $2
            WHERE id = $1`,
          [product.id, decision.unavailable],
        );
        break;
      }
    }
  }

  return summary;
}

import type { FastifyInstance } from 'fastify';
import { pool } from '../db/connection.js';
import { firebaseAuth } from '../middleware/auth.js';
import { scrapeProduct } from '../services/scraper.js';

const MAX_PRODUCTS_PER_USER = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PRODUCT_COLUMNS =
  'id, user_id, source_url, name, description, image_url, current_price, currency, unavailable, scrape_failures, last_checked_at, created_at, updated_at';

interface ProductRow {
  id: string;
  user_id: string;
  source_url: string;
  name: string;
  description: string | null;
  image_url: string | null;
  current_price: string; // DECIMAL chega como string do pg
  currency: string;
  unavailable: boolean;
  scrape_failures: number;
  last_checked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toProduct(row: ProductRow) {
  return {
    id: row.id,
    source_url: row.source_url,
    name: row.name,
    description: row.description,
    image_url: row.image_url,
    current_price: Number(row.current_price),
    currency: row.currency,
    unavailable: row.unavailable,
    scrape_failures: row.scrape_failures,
    last_checked_at: row.last_checked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function productRoutes(app: FastifyInstance) {
  app.addHook('preHandler', firebaseAuth);

  app.post('/products', async (request, reply) => {
    const uid = request.firebaseUid!;
    const body = request.body as { source_url?: unknown } | undefined;
    const sourceUrl = body?.source_url;
    if (typeof sourceUrl !== 'string' || !sourceUrl) {
      return reply.status(400).send({ error: 'Campo "source_url" é obrigatório' });
    }
    let url: URL;
    try {
      url = new URL(sourceUrl);
    } catch {
      return reply.status(400).send({ error: 'source_url inválida' });
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return reply.status(400).send({ error: 'source_url deve ser http(s)' });
    }

    const [{ count }] = (
      await pool.query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM products WHERE user_id = $1',
        [uid],
      )
    ).rows;
    if (Number(count) >= MAX_PRODUCTS_PER_USER) {
      return reply.status(429).send({
        error: `Limite de ${MAX_PRODUCTS_PER_USER} produtos por usuário atingido`,
      });
    }

    const scraped = await scrapeProduct(sourceUrl);
    if (!scraped) {
      return reply.status(422).send({
        error: 'Não conseguimos ler o preço dessa página. Confira se o URL é de um produto válido.',
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<ProductRow>(
        `INSERT INTO products
           (user_id, source_url, name, description, image_url, current_price, currency, last_checked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         RETURNING ${PRODUCT_COLUMNS}`,
        [
          uid,
          sourceUrl,
          scraped.name.slice(0, 500),
          scraped.description ?? null,
          scraped.imageUrl ?? null,
          scraped.price,
          scraped.currency,
        ],
      );
      const product = rows[0];
      // Grava o primeiro ponto do histórico, senão o gráfico fica vazio até a 1ª mudança
      await client.query(
        'INSERT INTO price_history (product_id, price) VALUES ($1, $2)',
        [product.id, product.current_price],
      );
      await client.query('COMMIT');
      return reply.status(201).send(toProduct(product));
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === '23505' // unique_violation
      ) {
        return reply.status(409).send({ error: 'Produto já cadastrado' });
      }
      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/products', async (request) => {
    const { rows } = await pool.query<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products WHERE user_id = $1 ORDER BY created_at DESC`,
      [request.firebaseUid!],
    );
    return rows.map(toProduct);
  });

  app.get('/products/:id', async (request, reply) => {
    const uid = request.firebaseUid!;
    const { id } = request.params as Record<string, string>;
    if (!UUID_RE.test(id)) {
      return reply.status(404).send({ error: 'Produto não encontrado' });
    }

    const { rows } = await pool.query<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1 AND user_id = $2`,
      [id, uid],
    );
    if (!rows[0]) {
      return reply.status(404).send({ error: 'Produto não encontrado' });
    }
    return toProduct(rows[0]);
  });

  app.get('/products/:id/history', async (request, reply) => {
    const uid = request.firebaseUid!;
    const { id } = request.params as Record<string, string>;
    if (!UUID_RE.test(id)) {
      return reply.status(404).send({ error: 'Produto não encontrado' });
    }

    const daysRaw = Number((request.query as Record<string, string>).days ?? 90);
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : 90;

    const { rows } = await pool.query<{ price: string; recorded_at: Date }>(
      `SELECT ph.price, ph.recorded_at
         FROM price_history ph
         JOIN products p ON p.id = ph.product_id
        WHERE p.id = $1 AND p.user_id = $2
          AND ph.recorded_at >= NOW() - make_interval(days => $3)
        ORDER BY ph.recorded_at ASC`,
      [id, uid, days],
    );

    return {
      product_id: id,
      days,
      points: rows.map((r) => ({ price: Number(r.price), recorded_at: r.recorded_at })),
    };
  });

  app.delete('/products/:id', async (request, reply) => {
    const uid = request.firebaseUid!;
    const { id } = request.params as Record<string, string>;
    if (!UUID_RE.test(id)) {
      return reply.status(404).send({ error: 'Produto não encontrado' });
    }

    const { rowCount } = await pool.query(
      'DELETE FROM products WHERE id = $1 AND user_id = $2',
      [id, uid],
    );
    if (rowCount === 0) {
      return reply.status(404).send({ error: 'Produto não encontrado' });
    }
    return reply.status(204).send();
  });
}

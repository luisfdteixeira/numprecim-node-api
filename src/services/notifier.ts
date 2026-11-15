import { setVapidDetails, sendNotification } from 'web-push';
import { pool } from '../db/connection.js';

const VAPID_SUBJECT = 'mailto:contato@numprecim.app';

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return false;
  setVapidDetails(VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  configured = true;
  return true;
}

function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(price);
  } catch {
    return `${price} ${currency}`;
  }
}

export interface PriceDrop {
  name: string;
  price: number;
  currency: string;
}

/** Envia push de queda de preço para todas as inscrições do usuário. Ignora insrições mortas (404/410). */
export async function notifyPriceDrop(userId: string, product: PriceDrop): Promise<number> {
  if (!ensureConfigured()) return 0;

  const { rows } = await pool.query<{ endpoint: string; p256dh: string; auth: string }>(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [userId],
  );
  if (rows.length === 0) return 0;

  const payload = JSON.stringify({
    title: 'Queda de preço! 🎉',
    body: `${product.name} agora por ${formatPrice(product.price, product.currency)}`,
    price: product.price,
  });

  let sent = 0;
  await Promise.allSettled(
    rows.map(async (sub) => {
      try {
        await sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent++;
      } catch (error: unknown) {
        const status = (error as { statusCode?: number }).statusCode;
        // 404/410 = inscrição expirada ou revogada pelo navegador → limpa do banco
        if (status === 404 || status === 410) {
          await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
        }
      }
    }),
  );
  return sent;
}

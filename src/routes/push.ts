import type { FastifyInstance } from 'fastify';
import { pool } from '../db/connection.js';
import { firebaseAuth } from '../middleware/auth.js';

export async function pushRoutes(app: FastifyInstance) {
  app.addHook('preHandler', firebaseAuth);

  app.post('/push/subscribe', async (request, reply) => {
    const uid = request.firebaseUid!;
    const body = request.body as
      | { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
      | undefined;

    if (!body?.endpoint || !body.keys?.p256dh || !body.keys.auth) {
      return reply.status(400).send({
        error: 'Campos obrigatórios: endpoint, keys.p256dh e keys.auth (objeto PushSubscription do navegador)',
      });
    }

    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, endpoint)
       DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [uid, body.endpoint, body.keys.p256dh, body.keys.auth],
    );

    return reply.status(201).send({ subscribed: true });
  });

  app.delete('/push/unsubscribe', async (request, reply) => {
    const uid = request.firebaseUid!;
    const endpoint = (request.body as { endpoint?: string } | undefined)?.endpoint;
    if (!endpoint) {
      return reply.status(400).send({ error: 'Campo "endpoint" é obrigatório' });
    }
    await pool.query(
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
      [uid, endpoint],
    );
    return reply.status(204).send();
  });
}

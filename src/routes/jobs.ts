import type { FastifyInstance } from 'fastify';
import { runPriceCheck } from '../jobs/price-checker.js';

export async function jobRoutes(app: FastifyInstance) {
  // Gatilho externo (cron-job.org) → POST /api/jobs/check-prices com header x-cron-secret
  app.post('/jobs/check-prices', async (request, reply) => {
    const expected = process.env.CRON_SECRET;
    if (!expected) {
      request.log.error('CRON_SECRET não configurado — job desabilitado');
      return reply.status(503).send({ error: 'Job de preços desabilitado' });
    }
    if (request.headers['x-cron-secret'] !== expected) {
      return reply.status(401).send({ error: 'Credencial de cron inválida' });
    }

    const summary = await runPriceCheck(request.log);
    return summary;
  });
}

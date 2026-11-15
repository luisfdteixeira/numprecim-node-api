import Fastify from 'fastify';
import { userRoutes } from './routes/users.js';
import { productRoutes } from './routes/products.js';
import { pushRoutes } from './routes/push.js';
import { jobRoutes } from './routes/jobs.js';

const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok' }));

await app.register(userRoutes, { prefix: '/api' });
await app.register(productRoutes, { prefix: '/api' });
await app.register(pushRoutes, { prefix: '/api' });
await app.register(jobRoutes, { prefix: '/api' });

const port = Number(process.env.PORT) || 3000;
app.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1); }
});

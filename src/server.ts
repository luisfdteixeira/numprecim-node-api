import Fastify from 'fastify';
import cors from '@fastify/cors';
import { userRoutes } from './routes/users.js';
import { productRoutes } from './routes/products.js';
import { pushRoutes } from './routes/push.js';
import { jobRoutes } from './routes/jobs.js';

const app = Fastify({ logger: true });

const frontendOrigins = (process.env.FRONTEND_URL ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

await app.register(cors, {
  origin: frontendOrigins.length ? frontendOrigins : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'],
});

app.get('/health', async () => ({ status: 'ok' }));

await app.register(userRoutes, { prefix: '/api' });
await app.register(productRoutes, { prefix: '/api' });
await app.register(pushRoutes, { prefix: '/api' });
await app.register(jobRoutes, { prefix: '/api' });

const port = Number(process.env.PORT) || 3000;
app.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1); }
});

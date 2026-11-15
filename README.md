# numprecim-node-api

API Node.js + Fastify + PostgreSQL (Supabase) para monitoramento de preços de produtos, com autenticação via Firebase e notificações web push.

## Stack

- Node.js 22+ (TypeScript, ESM)
- Fastify
- PostgreSQL (Supabase) via `pg`
- Firebase Auth (verificação de ID Token com Admin SDK)
- Scraper: `cheerio` + `axios` (cascata JSON-LD → meta tags → heurística CSS)
- Push: `web-push` (VAPID)
- Cron: endpoint protegido `POST /api/jobs/check-prices` + agendador externo (cron-job.org, a cada 6h)

## Como funciona

1. O frontend autentica no Firebase e envia o ID Token (`Authorization: Bearer <token>`) em cada chamada.
2. `POST /api/products` faz o scraping da página no momento do cadastro (422 se não achar preço).
3. O cron externo chama o endpoint de verificação a cada 6h; a cada ciclo, produtos com `last_checked_at < 24h` são re-verificados:
   - preço **caiu** → grava histórico, atualiza `current_price` e envia push;
   - preço **subiu** → grava histórico e atualiza `current_price` (sem push);
   - preço **igual** → só atualiza `last_checked_at`;
   - falha no scraping → incrementa `scrape_failures`; na 5ª falha consecutiva o produto fica `unavailable` e sai da fila.
4. Limite de 50 produtos por usuário (429 acima disso).

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/users` | Registra o usuário (uid do token; idempotente) |
| GET | `/api/users/me` | Perfil do usuário logado |
| PATCH | `/api/users/me` | Atualiza nome |
| POST | `/api/products` | Cadastra produto por URL (scrape imediato) |
| GET | `/api/products` | Lista produtos do usuário |
| GET | `/api/products/:id` | Detalhe |
| DELETE | `/api/products/:id` | Remove produto (+ histórico) |
| GET | `/api/products/:id/history` | Pontos para gráfico (`?days=90`) |
| POST | `/api/push/subscribe` | Salva inscrição push |
| DELETE | `/api/push/unsubscribe` | Remove inscrição |
| POST | `/api/jobs/check-prices` | Roda ciclo de verificação (header `x-cron-secret`) |
| GET | `/health` | Health check (sem auth) |

## Setup local

```bash
npm install
cp .env.example .env   # preencha as variáveis
npm run db:schema      # ou aplique src/db/schema.sql no SQL Editor do Supabase
npm run dev
```

Variáveis de ambiente: veja `.env.example` (chaves VAPID via `npx web-push generate-vapid-keys`; Firebase via Service Account JSON).

## Deploy (Fly.io)

```bash
fly launch --no-deploy        # cria o app com o fly.toml (região gru)
fly secrets set DATABASE_URL=... FIREBASE_PROJECT_ID=... FIREBASE_CLIENT_EMAIL=... FIREBASE_PRIVATE_KEY=... VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... CRON_SECRET=...
fly deploy
```

## Cron externo

No [cron-job.org](https://cron-job.org):

1. Crie um job com URL `https://<app>.fly.dev/api/jobs/check-prices`, método **POST**.
2. Header customizado: `x-cron-secret: <valor do CRON_SECRET no Fly>`.
3. Agendamento: **a cada 6 horas**.

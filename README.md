# NumPrecim - API

Node.js + Fastify + PostgreSQL (Supabase) API for product price monitoring, with Firebase authentication and web push notifications.

![Node.js](https://img.shields.io/badge/Node.js-22+-339933?style=for-the-badge&logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-000000?style=for-the-badge&logo=fastify&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)
![Web Push](https://img.shields.io/badge/Web%20Push-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![Fly.io](https://img.shields.io/badge/Fly.io-24175B?style=for-the-badge&logo=flydotio&logoColor=white)

## Stack

- Node.js 22+ (TypeScript, ESM)
- Fastify
- PostgreSQL (Supabase) via `pg`
- Firebase Auth (ID Token verification with Admin SDK)
- Scraper: `cheerio` + `axios` (fallback chain: JSON-LD → meta tags → CSS heuristic)
- Push: `web-push` (VAPID)
- Cron: protected endpoint `POST /api/jobs/check-prices` + external scheduler (cron-job.org, every 6h)

## How it works

1. The frontend authenticates with Firebase and sends the ID Token (`Authorization: Bearer <token>`) on every request.
2. `POST /api/products` scrapes the page at registration time (422 if no price is found).
3. The external cron calls the check endpoint every 6h; on each cycle, products with `last_checked_at < 24h` are re-checked:
   - price **dropped** → writes history, updates `current_price`, and sends a push;
   - price **rose** → writes history and updates `current_price` (no push);
   - price **unchanged** → only updates `last_checked_at`;
   - scraping failure → increments `scrape_failures`; on the 5th consecutive failure the product becomes `unavailable` and leaves the queue.
4. Limit of 50 products per user (429 above that).

## Endpoints

| Method | Route | Description |
|---|---|---|
| POST | `/api/users` | Registers the user (uid from token; idempotent) |
| GET | `/api/users/me` | Logged-in user profile |
| PATCH | `/api/users/me` | Updates name |
| POST | `/api/products` | Registers a product by URL (immediate scrape) |
| GET | `/api/products` | Lists the user's products |
| GET | `/api/products/:id` | Product detail |
| DELETE | `/api/products/:id` | Removes the product (+ history) |
| GET | `/api/products/:id/history` | Chart data points (`?days=90`) |
| POST | `/api/push/subscribe` | Saves push subscription |
| DELETE | `/api/push/unsubscribe` | Removes push subscription |
| POST | `/api/jobs/check-prices` | Runs the check cycle (header `x-cron-secret`) |
| GET | `/health` | Health check (no auth) |

## Local setup

```bash
npm install
cp .env.example .env
npm run db:schema 
npm run dev
``` 

Environment variables: see .env.example (VAPID keys via npx web-push generate-vapid-keys; Firebase via Service Account JSON).

### Deploy 
```bash
fly launch --no-deploy
fly secrets set DATABASE_URL=... FIREBASE_PROJECT_ID=... FIREBASE_CLIENT_EMAIL=... FIREBASE_PRIVATE_KEY=... VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... CRON_SECRET=...
fly deploy
```

### External cron
On cron-job.org:
1. Create a job with URL https://<app>.fly.dev/2. api/jobs/check-prices, method POST.
3. Custom header: x-cron-secret: <CRON_SECRET value in Fly>.
4. Schedule: every 6 hours.

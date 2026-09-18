# Sentinel: How It Starts and Works

## 1. Start the local stack

Prerequisites: Node.js 22+, npm, and Docker Desktop.

```sh
cp .env.example .env
npm install
npm run db:generate
docker compose up -d
DATABASE_URL='postgresql://sentinel:sentinel@localhost:5432/sentinel?schema=public' \
REDIS_URL='redis://localhost:6379' \
API_PORT=3001 npm run dev:api
```

In a second terminal:

```sh
NEXT_PUBLIC_API_URL=http://localhost:3001/api npm run dev:web
```

Open:

- Web dashboard: `http://localhost:3000`
- API: `http://localhost:3001/api`
- Swagger UI: `http://localhost:3001/api/docs`
- Liveness: `http://localhost:3001/api/health`
- Readiness: `http://localhost:3001/api/ready`
- Metrics: `http://localhost:3001/api/metrics`

Apply database migrations when the schema changes:

```sh
DATABASE_URL='postgresql://sentinel:sentinel@localhost:5432/sentinel?schema=public' \
npx prisma migrate dev --schema=packages/database/prisma/schema.prisma
```

## 2. System flow

```mermaid
flowchart LR
  Browser[Next.js browser] -->|JWT REST requests| API[NestJS API]
  Browser -->|scan.subscribe| WS[WebSocket gateway]
  API --> DB[(PostgreSQL / Prisma)]
  API --> Queue[(Redis / BullMQ)]
  Queue --> Worker[Scanner worker]
  Worker --> Target[Authorized public target]
  Worker --> DB
  Worker -->|scan.progress| Queue
  Queue --> WS
```

## 3. Authentication flow

1. The browser submits credentials to `POST /api/auth/login`.
2. The API verifies the Argon2 password hash.
3. The API returns a short-lived access token and a refresh token.
4. Refresh tokens are stored only as SHA-256 hashes in PostgreSQL.
5. `POST /api/auth/refresh` rotates the refresh session and revokes the old one.
6. Protected requests send `Authorization: Bearer <accessToken>`.
7. Workspace resources also require `x-workspace-id` and membership validation.
8. Password reset and email verification tokens are hashed, expiring, and single-use.

The current frontend login client keeps tokens in `sessionStorage` for the development shell. Production should move refresh handling to secure, HttpOnly cookies.

## 4. Workspace and asset flow

1. An authenticated user creates a workspace.
2. The creator becomes the OWNER.
3. OWNER users add registered members and assign ANALYST or VIEWER roles.
4. Assets are normalized and checked for URLs, localhost, private IPs, and metadata ranges.
5. Domain ownership uses a DNS TXT record at `_sentinel.<domain>`.
6. Active scans are rejected until the asset is VERIFIED.
7. Every query includes both the authenticated user and workspace boundary to prevent IDOR.

## 5. Scan flow

A scan request is intentionally short-lived:

```text
POST /api/scans
  -> verify membership and asset ownership
  -> require verification for active modes
  -> create QUEUED scan in PostgreSQL
  -> enqueue BullMQ job in Redis
  -> return scanId immediately
```

The scanner worker then:

1. Resolves DNS and rejects private or metadata addresses.
2. Resolves again immediately before the request and rejects address-set changes.
3. Performs TLS certificate, protocol, and cipher inspection (legacy TLS on active modes).
4. Performs HTTPS and header checks.
5. On NORMAL/AGGRESSIVE, crawls in-scope pages and probes discovered endpoints.
6. Persists deterministic findings (replacing any previous rows for that scan).
7. Calculates a deterministic score.
8. Updates scan stage/progress.
9. Publishes progress through Redis for WebSocket subscribers.
10. Creates in-app completion, critical-finding, and score-drop notifications.

Workers never receive arbitrary URLs from the browser. They receive an asset ID and load the authorized target from PostgreSQL.

## 6. Findings, reports, and schedules

- Findings belong to a workspace, asset, and scan.
- Analysts can acknowledge, resolve, or mark findings false positive.
- Status changes create immutable audit records.
- `GET /api/scans/diff?previous=<id>&current=<id>` compares findings across scans.
- Completed scans can produce JSON or CSV reports.
- Scheduled scans use BullMQ repeat jobs and support daily, weekly, monthly, pause, resume, and delete operations.
- Notifications are workspace- and user-scoped.

## 7. Production startup

Production uses `docker-compose.prod.yml` and `.env.production`.

```sh
cp .env.production.example .env.production
```

Set at least:

- `POSTGRES_PASSWORD` and the same password inside `DATABASE_URL` (host `postgres`, not `localhost`)
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (long random values)
- `WEB_ORIGIN` to the URL people type in the browser, for example `http://localhost` or `https://sentinel.example.com`
- `NEXT_PUBLIC_API_URL=/api` so the dashboard talks to Nginx on the same origin

Generate secrets:

```sh
openssl rand -hex 32
```

Start the stack:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Nginx listens on port 80, serves the web app, and forwards `/api/` and `/socket.io/` to the API. The API runs Prisma migrations on boot. The scanner container runs as a non-root user with dropped capabilities, no-new-privileges, a read-only filesystem, CPU/memory limits, and a small temporary filesystem.

SMTP (`SMTP_URL`) and Stripe keys are optional. Leave them empty until you want mail delivery or billing.

On a VPS, point DNS at the host, set `WEB_ORIGIN` to `https://your-domain`, put TLS in front of Nginx (Caddy, Traefik, or a host reverse proxy), and keep `.env.production` off the repository.

## 7b. Render

Use **Node 22**, repo root, and `npm ci --include=dev` so Nx/Prisma stay available during the build. Do not set `NODE_ENV` in the dashboard; Render sets it at runtime. Setting it as an env var makes `npm ci` skip `devDependencies` and the scanner build fails with "Could not find Nx modules".

**Web**

- Build: `npm ci --include=dev && NX_DAEMON=false npx nx build web --configuration=production`
- Start: `npx next start apps/web --hostname 0.0.0.0 --port $PORT`
- Env: `NEXT_PUBLIC_API_URL=https://<api-service>.onrender.com/api` (must be present at **build** time)

Nx writes Next.js output to `apps/web/.next`, not `dist/apps/web`.

**API**

- Build: `npm ci --include=dev && npx prisma generate --schema=packages/database/prisma/schema.prisma && NX_DAEMON=false npx nx build api --configuration=production`
- Start: `npx prisma migrate deploy --schema=packages/database/prisma/schema.prisma && node dist/apps/api/main.js`
- Env (required): `DATABASE_URL` (Neon unpooled URL), `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `WEB_ORIGIN=https://<web-service>.onrender.com`
- Optional: `ADMIN_EMAILS=admin@sentinel.dev` (comma-separated). Those users skip asset DNS verification.
- Do not set `API_PORT`; Render injects `PORT`

**Scanner (Web Service)**

- Build: `npm ci --include=dev && npx prisma generate --schema=packages/database/prisma/schema.prisma && NX_DAEMON=false npx nx build scanner --configuration=production`
- Start: `node dist/apps/scanner/main.js`
- Env: same `DATABASE_URL` and `REDIS_URL` as the API
- Leave **Port** empty; the process binds `0.0.0.0:$PORT` for health before connecting to Redis

## 8. Verification commands

```sh
npm run db:generate
CI=1 npx nx run-many -t build test --projects=api,scanner,web --outputStyle=static
CI=1 npx nx e2e web-e2e --outputStyle=static
npm audit --audit-level=high
```

The CI workflow repeats these checks with PostgreSQL and Redis service containers.

# Grand LMS

A learning platform for many schools at once, built around video. Schools invite their
instructors and students, and everything they do stays inside the school. The platform runs on a
NestJS backend with real-time updates, and deploys on free tiers only.

This is **Phase 0: the foundation**. It covers:
- accounts and devices
- schools and roles
- email invitations
- live presence
- background jobs
- the security model

Courses and video lessons come next; see the [roadmap](docs/roadmap.md). The video Explore pages
from the earlier FundaStream app are still here: trending, browse, search and watch across
YouTube, Dailymotion and Twitch.

## What's in it

- **Accounts**:
  - Sign up and sign in with email and password (Argon2id).
  - The session survives reloads through a rotating, httpOnly refresh cookie.
  - A list of signed-in devices, each of which can be signed out remotely and instantly.
- **Schools**:
  - Anyone can create a school with its own address (`/s/{school}`) and becomes its owner.
  - Schools are fully isolated from each other by Postgres row-level security.
- **Roles**: owner, admin, instructor, student. People manage only the roles below their own, and
  the owner can't be removed.
- **Invitations**:
  - Admins invite by email.
  - The link works once, for 7 days, and only for the invited address. Accepting it verifies that address.
  - Inviting the same address again replaces the old link.
- **Live**: members see who's online in their school, and new members appear instantly. A device
  signed out elsewhere is disconnected at once.
- **Explore**: the streaming-style video pages. A billboard, rows, search and in-app players for
  YouTube, Dailymotion and Twitch, through a server-side proxy that keeps the keys off the page.

## How it fits together

```text
browser ──► Netlify: apps/web (React)          /api/*    → video proxy function
                                               /api/v1/* → proxied to the API (same origin)
        ──► wss ──┐
                  ▼
        one server: Caddy ► apps/api (NestJS 12, Fastify, Socket.IO) ─┬─► PostgreSQL 17 (row-level security)
                            apps/worker (NestJS, BullMQ, email)       ─┴─► Redis 8 (queues, limits, pub/sub)
```

| Package | What it is |
| --- | --- |
| [`apps/web`](apps/web) | React 19, React Router 7, TanStack Query, Motion, Sass modules on design tokens. Vite 8. |
| [`apps/api`](apps/api) | NestJS 12 on Fastify: REST under `/api/v1`, Socket.IO at `/api/v1/ws`. Drizzle ORM on postgres.js. |
| [`apps/worker`](apps/worker) | Moves outbox events into BullMQ, sends email over SMTP, cleans up nightly. |
| [`packages/contracts`](packages/contracts) | Zod schemas for every request and the types of every response and real-time event, shared by all three. |

[docs/architecture.md](docs/architecture.md) walks through a request end to end. It also covers
the tenancy model, sign-in, real-time and background jobs. The decisions are recorded in
[docs/adr](docs/adr).

## Security

- **Tenant isolation in the database**:
  - The API connects as a role that owns nothing, so row-level security always applies to it.
  - Every transaction states which person and school it acts for.
  - A query that forgets its school filter returns nothing from other schools.
  - The tests prove this against Postgres itself.
- **Sessions**:
  - Access tokens live 15 minutes and stay in the page's memory.
  - Refresh tokens are single-use, stored hashed, and scoped to `/api/v1/auth` in an httpOnly,
    SameSite=Strict cookie.
  - Replaying a used refresh token ends the whole session. Signing out takes effect everywhere at once.
- **Brute force**:
  - Argon2id with OWASP's settings.
  - An unknown address takes as long to answer as a wrong password.
  - Ten failed logins lock that address for 15 minutes.
  - Redis sliding-window rate limits apply per person or per address, with `RateLimit-*` headers.
- **Input**:
  - Every body, query and parameter is validated by the shared zod schemas. Unknown fields are refused.
  - JSON only, up to 100 KiB, which also blocks form-based CSRF.
  - Errors have one shape and never include internals.
- **WebSockets**:
  - Single-use 30-second tickets (never tokens in URLs) and an origin allowlist.
  - Message size caps and per-connection budgets.
- **Audit log**: append-only at the database level. Invitation links are removed from stored
  events once they're emailed.
- **Web app**:
  - A strict Content-Security-Policy: own scripts only, Trusted Types, and connections only to
    its own origin and the API's WebSocket host.
  - HSTS and friends, for the page and the API.

## What it costs: $0

| Service | Free tier | Used for |
| --- | --- | --- |
| Netlify | Free plan, hard cap (the site pauses, nothing is billed) | The web app, the `/api/v1` proxy, the video proxy function |
| Oracle Cloud Always Free | Ampere server, up to 4 cores and 24 GB | The API, the worker, Postgres, Redis, Caddy (Docker Compose) |
| DuckDNS | Free subdomains | The API's address |
| Let's Encrypt (through Caddy) | Free certificates | HTTPS for the API |
| Brevo or Resend | 300 or 100 emails a day | Invitation emails |
| YouTube Data API, Dailymotion, Twitch | Free quotas | The Explore pages |

The step-by-step setup is in [docs/deploy.md](docs/deploy.md).

## Getting started

You need Node 22 and Docker.

```bash
npm install
cp .env.example .env         # works as is for local development
npm run infra:up             # Postgres, Redis and Mailpit in Docker
npm run db:migrate           # creates the tables, policies and grants

npm run dev:api              # http://localhost:3000/api/v1 (OpenAPI at /api/v1/openapi.json)
npm run dev:worker           # relays events and sends email to Mailpit: http://localhost:8025
npm run dev:web              # http://localhost:5173, proxying /api/v1 to the API
```

The Explore pages need no keys in mock mode: `npm run dev:mock -w @grand/web`. With real keys in
`.env`, they use the platforms' APIs; `.env.example` explains where to get each key.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev:web` / `dev:api` / `dev:worker` | Each app in watch mode |
| `npm run build` | Builds every package (contracts first) |
| `npm run typecheck` | TypeScript checks for the API, worker and contracts |
| `npm run lint` | ESLint everywhere |
| `npm test` | Every test suite. The API and worker suites need Postgres and Redis (see below). |
| `npm run db:migrate` | Applies pending SQL migrations, as the database owner |
| `npm run infra:up` / `infra:down` | Starts or stops the local services |

### Tests

- **The web app**: its tests need nothing running.
- **The API and the worker**: their tests run against real Postgres and Redis. They create their
  own databases (`grand_test`, `grand_worker_test`) and use Redis database 15.
  - With `npm run infra:up`, the defaults work.
  - Otherwise, set `TEST_DATABASE_ADMIN_URL` (a superuser connection string) and `TEST_REDIS_URL`.

The suites cover:
- row-level security, straight against the database
- sign-up, login and lockout
- refresh rotation and reuse detection, including simultaneous refreshes
- devices, schools and the role rules
- invitations, from creation to acceptance
- rate limits
- WebSocket tickets, rooms, presence and instant sign-out
- the worker's relay, email and clean-up
- the page's security rules

CI runs everything on every push and pull request, and builds the Docker images
([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Project layout

```text
apps/
  web/        React app, the Netlify video proxy (server/, netlify/), security headers (config/)
  api/        NestJS API: src/{auth,schools,realtime,database,rate-limit,events,health}, migrations/, test/
  worker/     NestJS worker: src/{jobs,mail}, test/
packages/
  contracts/  shared zod schemas and types
infra/        docker-compose (local and production), Caddyfile, Postgres init
docs/         architecture, decision records, deployment, roadmap
```

# Architecture

Grand LMS is a learning platform for many schools at once, built around video. This page describes
Phase 0: the foundation every later feature stands on. It covers accounts, schools and their
members, invitations, real-time updates, background jobs and the security model. The decisions
behind it are recorded in [docs/adr](adr).

## The pieces

```text
                    ┌──────────────────────────── Netlify (free) ────────────────────────────┐
browser ──https──►  │ apps/web: React app (static)                                           │
                    │ /api/*      → video proxy function (YouTube, Dailymotion, Twitch)      │
                    │ /api/v1/*   → proxied to the API server (same origin: first-party cookie) │
                    └─────────────────────────────────────┬─────────────────────────────────┘
                                                          │ https
browser ──wss (Socket.IO, ticket sign-in)──────────┐      ▼
                    ┌──────────── one small server (Oracle Cloud Always Free) ───────────────┐
                    │ Caddy (HTTPS, Let's Encrypt)                                           │
                    │   └► apps/api: NestJS 12 on Fastify, REST /api/v1 + Socket.IO /api/v1/ws │
                    │ apps/worker: NestJS (no HTTP): outbox relay, BullMQ jobs, email, clean-up │
                    │ PostgreSQL 17 (row-level security)       Redis 8 (queues, limits, pub/sub) │
                    └────────────────────────────────────────────────────────────────────────┘
```

| Package | What it is |
| --- | --- |
| `apps/web` | The React app (Vite, React Router, TanStack Query, Motion, Sass modules). Also the Netlify function that proxies the video platforms. |
| `apps/api` | The HTTP and WebSocket API. |
| `apps/worker` | Background work: moves outbox events into BullMQ, sends email, cleans up expired rows. |
| `packages/contracts` | The API contract shared by all three: zod schemas for every request body, response types, real-time event types. |

## A request, end to end

1. The browser calls `/api/v1/...` on the web app's own origin. Netlify proxies it to the API, so
   the refresh cookie is first-party and the browser needs no CORS.
2. Caddy terminates TLS and forwards the request to the API.
3. Fastify gives it a request id: a well-formed incoming `X-Request-Id` is kept, otherwise one is
   generated. The id is returned in the response, logged by pino, and included in every error body.
4. Guards run in this order:
   1. `AuthGuard` checks the bearer token (JWT, HS256, issuer, audience, type, expiry), then asks
      Redis whether the session was revoked.
   2. `RateLimitGuard` counts per person, or per address when signed out, in a Redis sliding window.
   3. On school routes, `SchoolAccessGuard` loads the school named by `:slug` and the caller's role,
      and compares it with the role the route needs.
5. The route's zod schema validates the body, query or parameters (`@Body({ schema })`, through
   Nest 12's Standard Schema support). Unknown fields are rejected, and the handler gets typed,
   trimmed and normalized input.
6. The service runs its queries in `DatabaseService.transaction({ userId, schoolId }, ...)`, which
   sets `app.user_id` and `app.school_id` for that transaction only. Row-level security reads them.
7. Changes that others need to hear about are written in the same transaction:
   - an audit entry (`audit_log`)
   - an outbox event (`outbox`), which the worker turns into jobs
8. After the commit, real-time events go to the school's Socket.IO room.
9. Every error comes back as `{ "error": { "code", "message", "details"?, "requestId" } }`. The
   codes are listed in `ApiErrorCode` in `packages/contracts`. Unexpected errors are logged and
   answered with a generic 500, so no SQL or stack trace ever leaves the server.

## Schools and row-level security

- Every school-scoped table has a `school_id`, and Postgres itself enforces the separation
  ([ADR 2](adr/0002-row-level-security.md)).
- The API connects as `grand_app`, a role that owns nothing, so policies always apply to it.
- Migrations run as the owner.
- `app.current_school_id()` and `app.current_user_id()` read the transaction's settings:

| Table | `grand_app` may | Policy |
| --- | --- | --- |
| `schools` | read, create, update | Anyone reads the public details; you create schools only in your own name; you update only the school the transaction acts for. |
| `memberships` | read, create, update, delete | Only the acting school's rows, plus read access to your own memberships in every school (your school list). |
| `invitations` | read, create, update | Only the acting school's rows. Someone holding a link finds it through `app.invitation_by_token(hash)`, a `SECURITY DEFINER` function that returns exactly one row. |
| `audit_log` | read, add | Append-only (no update or delete grants). Entries for another school are refused. |
| `users`, `sessions`, `refresh_tokens`, `outbox` | as granted | Not school-scoped. They're reached only through the services, by id or by token hash. |

There are more guarantees:
- One owner per school is a partial unique index.
- An open invitation per address and school is another.
- Addresses are stored lower-cased, and a `CHECK` constraint enforces it.
- Transactions time out: a statement after 10 s, an idle transaction after 15 s.

`apps/api/test/rls.test.ts` checks all of this straight against Postgres as `grand_app`:
- queries with no school filter at all
- inserts forged into another school
- attempts to disable RLS
- settings leaking between pooled connections

## Signing in

See [ADR 3](adr/0003-sessions-and-tokens.md).

- **Passwords**:
  - Argon2id with OWASP's minimum settings (19 MiB of memory, 2 passes).
  - Hashes made with weaker settings are upgraded at the next login.
  - An unknown address is checked against a dummy hash, so it takes as long to answer as a wrong password.
  - Ten failed logins lock that address for 15 minutes. There is also a per-address request limit.
- **Access tokens**:
  - JWTs valid for 15 minutes, held in the page's memory only, never in storage.
  - They carry the session id, so ending a session blocks its tokens at once: Redis holds a
    revocation marker for as long as a token could still be valid.
- **Refresh tokens**:
  - 32 random bytes in an httpOnly, `SameSite=Strict` cookie that only `/api/v1/auth` receives.
  - Stored as SHA-256 hashes.
  - Each one works once: using it issues the next.
  - Presenting a used one again means it was copied, so the whole session ends, for both copies.
  - Claiming a token is a single atomic `UPDATE`, so two simultaneous refreshes can't both win.
  - The refresh and logout routes also require the web app's `Origin`.
- **Devices**: `/auth/sessions` lists signed-in devices, and any of them can be signed out. Its
  WebSockets are disconnected immediately.

## Real-time

See [ADR 5](adr/0005-realtime.md).

- Socket.IO runs on the API's own port at `/api/v1/ws`. It accepts WebSocket transport only, and
  only from the web app's origins.
- **Signing in**:
  - The app first asks `POST /realtime/ticket` for a ticket: random, valid for 30 seconds, and
    usable once (Redis `GETDEL`).
  - The ticket goes in the Socket.IO handshake, not in the URL.
  - A middleware refuses the connection when the ticket is missing, already used, or its session was revoked.
- **Rooms**:
  - `user:{id}` and `session:{id}` are joined automatically.
  - `school:{id}` is joined after a membership check.
  - The Redis adapter shares the rooms across API instances.
- **Events**:
  - Members joining, changing role or leaving.
  - Presence: who is connected to a school.
  - Session revoked.
- **Limits**:
  - 16 KiB per message.
  - 20 events in a burst, then 5 a second.
  - A client that keeps exceeding the limit is disconnected.

## Background work

See [ADR 4](adr/0004-outbox.md).

1. The API writes events to the `outbox` table in the same transaction as the change they
   describe, so none is lost and none is sent for a change that rolled back.
2. A trigger sends `NOTIFY outbox` on commit.
3. The worker's relay wakes on the notification, and also polls every 5 s as a safety net.
4. It claims rows with `FOR UPDATE SKIP LOCKED` and adds them to BullMQ with the job id
   `outbox-{id}`, so a re-published event is never queued twice.
5. Jobs retry with exponential backoff (8 attempts).
6. The processor checks `processed_at` first and sets it last. A crash can repeat an email, but
   never lose one.
7. Secrets in a payload (the invitation link) are deleted once handled.
8. A BullMQ job scheduler runs the nightly clean-up. Only one worker runs it, however many are up.

## Operations

- **Health**:
  - `GET /api/v1/health/live` checks that the process is up.
  - `GET /api/v1/health/ready` checks Postgres and Redis, each within 2 s.
- **Logs**: pino JSON in production, with pretty lines in development.
  - Authorization headers and cookies are redacted.
  - Health checks aren't logged.
- **API documentation**: the OpenAPI document at `/api/v1/openapi.json`, generated from the same
  zod schemas. It's off in production unless `OPENAPI=true`.
- **Shutdown**: SIGTERM stops new requests (503), lets running ones finish, closes the sockets,
  leaves the Redis channels, then closes the database and Redis connections.
- **Headers**:
  - The API sends a CSP of `default-src 'none'`, `X-Frame-Options: DENY` and `Cache-Control: no-store`.
  - It sends HSTS in production.
  - It accepts JSON bodies only, up to 100 KiB.

## Tests

| Suite | Runs against | Covers |
| --- | --- | --- |
| `apps/api/test/*.test.ts` | Real Postgres and Redis (`grand_test`, Redis db 15) | Row-level security, sign-up and login, refresh rotation and reuse, devices, schools, members and roles, invitations, rate limits, WebSockets, headers and errors. |
| `apps/api/src/**/*.spec.ts` | Nothing external | Configuration, cursors, address masking. |
| `apps/worker/test` | Real Postgres and Redis | Relay deduplication, email and scrubbing, idempotent retries, clean-up. |
| `apps/web/tests` | Mocks | The video proxy, client logic, security rules for the page. |

Set `TEST_DATABASE_ADMIN_URL` (a superuser connection string) and `TEST_REDIS_URL`. With
`npm run infra:up`, the defaults already point at the right place.

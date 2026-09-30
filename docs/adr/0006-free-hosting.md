# 6. Free hosting

**Status:** accepted, 2026-09-30

## Context
Grand LMS must run at no cost, with no credit card that could be charged. The API needs a
long-running process for WebSockets, plus Postgres and Redis.

## Decision
- **The web app**: stays on Netlify's free plan. It has a hard cap: the site pauses, and nothing
  is ever billed. `/api/v1/*` is proxied to the API, so cookies stay first-party.
- **Everything else** runs on one Oracle Cloud Always Free Ampere server (up to 4 cores and 24 GB),
  with Docker Compose:
  - Caddy, with free Let's Encrypt certificates
  - the API
  - the worker
  - PostgreSQL 17
  - Redis 8
- **Domain**: a free DuckDNS name points at the server.
- **Email**: any SMTP provider's free tier (Brevo: 300 a day; Resend: 100 a day).
- **Later**: video files will go to Cloudflare R2's free tier (10 GB, no egress fees), with a
  storage quota per school.

## Consequences
- One server is a single point of failure. docs/deploy.md covers nightly database backups and how
  to restore them. The stateless API and the worker could move to more servers later, since
  sessions, rooms and queues live in Postgres and Redis.
- Oracle can reclaim idle Always Free servers. A normal amount of traffic, or the health checks,
  keep it active.

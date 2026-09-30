# 1. One repository; NestJS 12 on Fastify

**Status:** accepted, 2026-09-30

## Context
The video app (a React front end and a small Netlify function) is becoming a learning platform
with a real backend. That backend needs accounts, many schools, background jobs and WebSockets.
The front end and the backend must agree on every request and event.

## Decision
- **npm workspaces**: `apps/web`, `apps/api`, `apps/worker`, `packages/contracts`.
- **Shared contract**: `packages/contracts` holds zod schemas for every request body and the
  TypeScript types of every response and real-time event. The API validates with them, and the web
  app reuses them for form validation. The web app imports the TypeScript source through a Vite
  alias, so it needs no build step.
- **NestJS 12 on Fastify**:
  - Its module system and guards suit a large API.
  - It validates Standard Schema (zod) natively in route decorators (`@Body({ schema })`) and
    turns the same schemas into the OpenAPI document.
  - Fastify is the faster adapter, and it serves Socket.IO on the same port.
- **The worker**: a separate NestJS application context without HTTP, so jobs never slow the API
  down and each can be scaled or restarted on its own.
- **The database layer**: Drizzle ORM on postgres.js for typed queries. The migrations are
  hand-written SQL, because row-level security policies, grants and `SECURITY DEFINER` functions
  are first-class there. drizzle-kit is left out; it isn't needed, and it pulled in a vulnerable esbuild.

## Consequences
- One `npm ci` installs everything, and CI checks all packages together.
- NestJS 12 packages are ESM-only, so the API and worker are ESM, with NodeNext resolution.
- Tests compile with SWC, which keeps the decorator metadata Nest's dependency injection needs.

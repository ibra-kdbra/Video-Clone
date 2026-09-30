# Project Diary

Date format: YYYY-MM-DD

## Index
- 2026-02-03 — Kickoff
- 2026-09-30 — Grand LMS, Phase 0

---

## 2026-02-03 — Kickoff

### Phase Tracker
- [x] Discovery & current-state review
- [ ] UI/UX design system plan
- [ ] Architecture & folder hierarchy
- [ ] React 19 + tooling migration
- [ ] Data layer & RapidAPI integration
- [ ] Component refactor & cleanup
- [ ] QA, accessibility, performance
- [ ] Documentation & handoff

### Goals
- Modern UI/UX for a video streaming platform.
- Scalable architecture and data layer while continuing RapidAPI usage.
- Upgrade dependencies and move to React 19.

### Notes
- Repo currently uses CRA with React 18 and MUI v5.
- Plan to modernize styling with a unified theme and component tokens.
- Plan to introduce a scalable data-fetching layer with caching and error states.

### Next Steps
- Audit dependencies in package.json and propose upgrade path.
- Draft new hierarchy (feature-based folders, shared UI, hooks, services).
- Prepare updated design language and layout structure.

---

## 2026-02-03 — Migration + UI refresh (Phase 1)

### Completed
- Upgraded core dependencies to React 19 and modernized the build tooling.
- Added Vite setup, new entry point, and MUI theme foundation.
- Created a scalable API layer using RapidAPI with React Query caching.
- Introduced a new pages hierarchy and updated routing.
- Refreshed key UI components: Navbar, Sidebar, Video grid, Cards, Loader.

### Decisions
- Chose Vite to replace CRA for React 19 compatibility and faster builds.
- Introduced React Query for caching, errors, and loading states.
- Adopted a dark, premium theme with MUI tokens.

### Pending
- Clean up legacy CRA artifacts and unused files.
- Update README and env variable naming for Vite (VITE_RAPID_API_KEY).
- Verify layout details and polish video cards.

---

## 2026-02-03 — UI polish (Phase 2)

### Completed
- Added video description block in the video detail page.
- Added channel description block in the channel detail page.
- Deprecated the legacy CRA entry file to avoid confusion.
 - Marked CRA public index.html as legacy to avoid Vite confusion.
 - Added a hero section and highlight chips on the feed page.
 - Added empty-state messaging across video lists.
 - Polished video cards with hover lift and metadata.
 - Aligned navbar content to a max-width container.
 - Styled chips and keyboard focus for accessibility.
 - Added containerized layouts to feed, search, video detail, and channel pages.
 - Enhanced video detail with stat chips and a side panel card.
 - Added channel stats chips and refined sidebar guidance.
 - Added micro-interactions to cards, sidebar items, and search focus state.
 - Memoized list-heavy components and enabled lazy image loading.
 - Added reduced-motion support for accessibility.
- Refined typography scale and paper surfaces for clearer hierarchy.
- Added skeleton loaders and richer empty states across pages.
- Improved search input with clear button and responsive width.
- Added mobile-friendly sidebar scrolling and softer hover interactions.

### Pending
- Remove or reconcile legacy CRA public index.html if needed.
- Continue component-level polish for cards and layouts.

---

## 2026-09-30 — Grand LMS, Phase 0

### Completed
- Turned the repository into an npm-workspaces monorepo: apps/web (the React app, moved as is),
  apps/api (NestJS 12 on Fastify), apps/worker (NestJS and BullMQ), and packages/contracts (zod
  schemas shared by all three).
- Built the data layer:
  - Postgres with hand-written SQL migrations and a migrator that uses an advisory lock and checksums.
  - Row-level security on every school-scoped table, with a non-owner app role.
  - An append-only audit log and a transactional outbox.
- Built accounts: Argon2id, 15-minute JWTs kept in memory, and rotating refresh cookies with reuse
  detection. Added devices with remote sign-out, and a login lockout.
- Built schools, roles, members and email invitations (outbox → BullMQ → SMTP).
- Added real-time over Socket.IO: ticket sign-in, school rooms, presence and instant sign-out,
  with the Redis adapter.
- Added operations: health checks, pino logs with request ids, OpenAPI from the zod schemas,
  graceful shutdown, Docker images, and Compose for local development and production.
- Added tests against real Postgres and Redis (API and worker), CI on GitHub Actions, and docs:
  architecture, ADRs, deployment and roadmap.

### Decisions
- Many schools share one database, separated by Postgres row-level security rather than by
  application code alone (ADR 2).
- Access tokens stay in memory, and refresh tokens live in a SameSite=Strict cookie, single use
  (ADR 3).
- A transactional outbox instead of sending from request handlers (ADR 4).
- Free hosting: Netlify for the app, one Oracle Always Free server for the API, and a DuckDNS name
  (ADR 6).
- Netlify doesn't proxy WebSockets, so the socket connects to the API host with single-use tickets
  (ADR 5).

### Pending
- Phase 1: courses, modules and lessons; video uploads to R2 with HLS transcoding.
- Email verification and password reset.
- Deploy the backend to Oracle Cloud and set API_ORIGIN on Netlify.

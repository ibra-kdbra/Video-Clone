# Grand LMS

A learning platform for many schools at once, built around video. Schools invite their
instructors and students, and everything they do stays inside the school. The platform runs on a
NestJS backend with real-time updates, and deploys on free tiers only.

This is **Phase 2: learning progress**, on top of the courses and video of Phase 1 and the
foundation of Phase 0:
- watch progress that counts only what was actually watched, resume, and completion
- quizzes graded on the server, and assignments with files, grades and feedback
- notifications in the app, live, and by email, as each person chooses
- insights for a course's editors: completion, where students stop watching, quiz results
- courses, modules and lessons, with drafts, publishing and enrollments
- video uploads straight to storage, transcoded to adaptive HLS by a worker
- accounts and devices, schools and roles, email invitations, live presence

**Try it:** the public site runs a demo school, Grand Academy, entirely in the browser (see
[Demo mode](#demo-mode)): sign in as its student, instructor or owner with one click.

Live classes and discussions come next; see the [roadmap](docs/roadmap.md). The video pages from
the earlier FundaStream app are still here, under Explore videos: trending, browse, search and
watch across YouTube, Dailymotion and Twitch.

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
- **Courses**:
  - Each school's page lists its courses: Continue learning, every published course, and for
    editors their drafts.
  - A course has modules of lessons. Lessons have Markdown notes and a video, and can be free
    previews.
  - Members enroll to watch. Owners and admins edit every course; instructors edit their own.
  - A lesson is a video lesson, a quiz or an assignment.
- **Course editor**: publish and archive; build the outline by drag and drop, across modules;
  edit each lesson in a drawer. A storage meter shows the school's quota.
- **Video**:
  - Uploads go from the browser straight to S3-compatible storage (Garage, self-hosted), in
    parallel parts with retries. They keep going while you move around the app.
  - The worker transcodes with ffmpeg to HLS from 1080p down to 360p, with a poster and a
    storyboard. Progress shows live.
  - Playback is adaptive, through signed links that expire. The player has quality, speed,
    picture in picture, keyboard shortcuts and thumbnails over the seek bar.
  - A lesson can use a YouTube, Dailymotion or Twitch video instead.
- **Progress**:
  - The player reports which 5-second stretches actually played. Skipping ahead counts nothing,
    and a lesson with an uploaded video completes at 90%.
  - Lessons resume where you stopped. Other lessons have Mark as complete.
  - Each course shows how far you are, and Continue learning takes you to the right lesson.
- **Quizzes**: one answer, several answers or a short typed answer, with a pass mark and an
  optional attempt limit. The server grades each attempt, and shows the right answers only once
  you've passed or run out of attempts. Passing completes the lesson.
- **Assignments**:
  - Students write an answer, attach files (up to 5 of 25 MB), save a draft and hand it in.
  - Editors see what's waiting, download the files, and grade or return the work with feedback.
- **Notifications**: a bell with the unread count, live, for new courses and lessons, handed-in
  work, grades and processed videos. Each kind can be turned on or off in the app and by email.
- **Insights** for a course's editors: enrolled and active students, completion per lesson, a
  retention curve for each video, quiz pass rates and the hardest questions, and grades. The
  Students tab shows each student's progress.
- **Explore**: the streaming-style video pages. A billboard, rows, search and in-app players for
  YouTube, Dailymotion and Twitch, through a server-side proxy that keeps the keys off the page.

## How it fits together

```text
browser ──► Netlify: apps/web (React)          /api/*    → video proxy function
                                               /api/v1/* → proxied to the API (same origin)
        ──► wss ──┐
                  ▼
        one server: Caddy ► apps/api (NestJS 12, Fastify, Socket.IO) ─┬─► PostgreSQL 17 (row-level security)
                            apps/worker (NestJS, BullMQ, ffmpeg) ─────┼─► Redis 8 (queues, limits, pub/sub)
        ──► signed URLs ──► Caddy ► Garage (S3 video store) ◄─────────┘
```

| Package | What it is |
| --- | --- |
| [`apps/web`](apps/web) | React 19, React Router 7, TanStack Query, Motion, Sass modules on design tokens. Vite 8. |
| [`apps/api`](apps/api) | NestJS 12 on Fastify: REST under `/api/v1`, Socket.IO at `/api/v1/ws`. Drizzle ORM on postgres.js. |
| [`apps/worker`](apps/worker) | Moves outbox events into BullMQ, sends notifications and email over SMTP, transcodes videos to HLS with ffmpeg, cleans up nightly. |
| [`packages/contracts`](packages/contracts) | Zod schemas for every request and the types of every response and real-time event, shared by all three. |

[docs/architecture.md](docs/architecture.md) walks through a request end to end. It also covers
the tenancy model, sign-in, real-time, background jobs, courses, the video pipeline, progress,
quizzes, assignments, notifications and insights. The decisions are recorded in
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
- **Video**: the bucket is private. Uploads, segments and images use presigned URLs that expire,
  and playlists need a token signed for that one video, given out after the enrollment check.
- **Quizzes and handed-in work**:
  - Quizzes are graded on the server, and their answers never reach the page before they're
    earned. Attempt limits hold under parallel requests.
  - Handed-in files are uploaded under a signature that fixes their type. They're only
    downloaded as attachments, never displayed, and only by the student and the course's editors.
- **Notifications** are readable only by their owner, enforced by row-level security, and can only
  be written for members of the school an event belongs to.
- **Audit log**: append-only at the database level. Invitation links are removed from stored
  events once they're emailed.
- **Web app**:
  - A strict Content-Security-Policy: own scripts only, Trusted Types, and connections only to
    its own origin, the API's WebSocket host and the video store.
  - HSTS and friends, for the page and the API.

## What it costs: $0

| Service | Free tier | Used for |
| --- | --- | --- |
| Netlify | Free plan, hard cap (the site pauses, nothing is billed) | The web app, the `/api/v1` proxy, the video proxy function |
| Oracle Cloud Always Free | Ampere server, up to 4 cores, 24 GB and 200 GB of disk | The API, the worker, Postgres, Redis, Garage (videos), Caddy (Docker Compose) |
| DuckDNS | Free subdomains | The API's and the video store's addresses |
| Let's Encrypt (through Caddy) | Free certificates | HTTPS for the API and the video store |
| Garage (self-hosted) | Open source, on the server's free disk | Video storage, S3-compatible |
| Brevo or Resend | 300 or 100 emails a day | Invitation and notification emails |
| YouTube Data API, Dailymotion, Twitch | Free quotas | The Explore pages |

The step-by-step setup is in [docs/deploy.md](docs/deploy.md).

## Getting started

You need Node 22, Docker, and ffmpeg for the worker (`sudo apt install ffmpeg`, `brew install ffmpeg`).

```bash
npm install
cp .env.example .env         # works as is for local development
npm run infra:up             # Postgres, Redis, Mailpit and Garage in Docker
npm run db:migrate           # creates the tables, policies and grants
npm run storage:setup        # creates the video bucket and its key in Garage

npm run dev:api              # http://localhost:3000/api/v1 (OpenAPI at /api/v1/openapi.json)
npm run dev:worker           # relays events and sends email to Mailpit: http://localhost:8025
npm run dev:web              # http://localhost:5173, proxying /api/v1 to the API
```

The Explore pages need no keys in mock mode: `npm run dev:mock -w @grand/web`. With real keys in
`.env`, they use the platforms' APIs; `.env.example` explains where to get each key.

### Demo mode

`VITE_DEMO=true` builds the web app to run the whole LMS in the browser, with no API server: every
`/api/v1` call goes to a mock of the API in the page ([apps/web/src/demo](apps/web/src/demo)), with
the API's rules, and a demo school (Grand Academy) seeded from `src/demo/content.js`. Sign in as its
student, instructor or owner with one click; changes stay in that browser until "Reset demo". The
public Netlify site is built this way (`netlify.toml`). Without the flag, none of it is in the build.

- **The school**: eight courses in mathematics, computing, science and history, with quizzes and
  assignments, about forty classmates whose progress, attempts and handed-in work fill the
  instructors' queues and insights, and notifications that arrive live (hand in an assignment and
  it's graded a few seconds later).
- **The videos**: most lessons embed lectures from 3Blue1Brown, CrashCourse and freeCodeCamp,
  credited in each lesson's notes. *The Physics of Sound* uses the school's own videos, played by
  the app's own player, so progress, resume and the retention chart work as they do with uploads.
  They're animated waveforms over synthesized tones, made from scratch by
  [apps/web/scripts/demo-media](apps/web/scripts/demo-media) (`render.py` draws them, `package.mjs`
  packages them as HLS like the worker does) and served from `public/demo/media`.

```bash
VITE_DEMO=true npm run dev -w @grand/web            # add `-- --mode mock` for the Explore pages without keys
VITE_DEMO=true npm run build -w @grand/web
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev:web` / `dev:api` / `dev:worker` | Each app in watch mode |
| `npm run build` | Builds every package (contracts first) |
| `npm run typecheck` | TypeScript checks for the API, worker and contracts |
| `npm run lint` | ESLint everywhere |
| `npm test` | Every test suite. The API and worker suites need Postgres and Redis (see below). |
| `npm run db:migrate` | Applies pending SQL migrations, as the database owner |
| `npm run storage:setup` | Gets the video bucket ready: in Garage, the node's role, the bucket and the key; on any store, CORS for `WEB_ORIGINS` and a rule that drops unfinished uploads. Safe to run again. |
| `npm run infra:up` / `infra:down` | Starts or stops the local services |

### Tests

- **The web app**: its tests need nothing running.
- **The API and the worker**: their tests run against real Postgres and Redis. They create their
  own databases (`grand_test`, `grand_worker_test`) and use Redis database 15.
  - With `npm run infra:up`, the defaults work.
  - Otherwise, set `TEST_DATABASE_ADMIN_URL` (a superuser connection string) and `TEST_REDIS_URL`.
  - The video tests also need a bucket and, for the worker, ffmpeg. After `npm run storage:setup`,
    set `TEST_S3_ENDPOINT=http://localhost:3900`, `TEST_S3_BUCKET=grand-media` and the
    `TEST_S3_ACCESS_KEY_ID` and `TEST_S3_SECRET_ACCESS_KEY` from `.env`. Without them those tests
    are skipped.

The suites cover:
- row-level security, straight against the database
- sign-up, login and lockout
- refresh rotation and reuse detection, including simultaneous refreshes
- devices, schools and the role rules
- invitations, from creation to acceptance
- rate limits
- WebSocket tickets, rooms, presence and instant sign-out
- courses, drafts, outlines and enrollments, and who may do what
- uploads, quotas, playback tokens and the rewritten playlists
- watch progress and completion, quiz grading and attempt limits under parallel requests,
  assignment files and grading, insights, the notification inbox and settings
- transcoding real clips (landscape, portrait, silent), refusing broken or too-long files, deleting
  videos and clearing abandoned uploads
- the worker's relay, email and clean-up, and who is notified of what
- the page's security rules

CI runs everything on every push and pull request, with Garage and ffmpeg. It also builds the
Docker images and transcodes test clips inside the worker image
([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Project layout

```text
apps/
  web/        React app, the Netlify video proxy (server/, netlify/), security headers (config/)
  api/        NestJS API: src/{auth,schools,courses,learning,notifications,storage,realtime,database,rate-limit,events,health}, migrations/, test/
  worker/     NestJS worker: src/{jobs,mail,media,notifications,files}, scripts/, test/
packages/
  contracts/  shared zod schemas and types
infra/        docker-compose (local and production), Caddyfile, Postgres init, Garage config
docs/         architecture, decision records, deployment, roadmap
```

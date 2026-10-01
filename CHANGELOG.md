# Changelog

All notable changes to this project will be documented in this file.

## [8.0.0] - 2026-10-01

**Grand LMS, Phase 2: learning progress.** Students' watching, quizzes and handed-in work are
recorded and graded, everyone hears about what concerns them, and a course's editors can see how
it's going.

### Added
- **Lesson kinds**: a lesson is a video lesson, a quiz or an assignment, chosen when it's added.
- **Watch progress**:
  - The player reports which 5-second stretches actually played, stored as a bitset. Replays
    count once and skipping ahead counts nothing.
  - A lesson with an uploaded video completes at 90%. Others have Mark as complete.
  - Lessons resume where you stopped.
  - Progress shows on the course page, the lesson outline and My courses. Continue learning
    follows your latest lesson.
- **Quizzes**:
  - A builder for one-answer, several-answer and short-answer questions, with points,
    explanations, a pass mark and an optional attempt limit.
  - Graded on the server. Short answers match ignoring case, accents and spacing.
  - The right answers and explanations are shown once you pass or run out of attempts. Passing
    completes the lesson.
  - Past attempts can be reviewed, question by question, with the answers you gave.
- **Assignments**:
  - Points, a due date, and a written answer, files or both.
  - Students save a draft, attach up to 5 files of 25 MB, and hand it in, which completes the
    lesson.
  - Editors see handed-in work, waiting first, download the files, and grade it or return it
    with feedback, moving from one submission to the next.
- **Notifications**:
  - A bell with the unread count and a notifications page (`/notifications`), updated live and
    across devices.
  - For new courses and lessons, handed-in work, grades and processed videos.
  - Email too, as each person chooses for each kind in Account → Notifications. Grades are
    emailed by default.
- **Insights** for a course's editors: enrolled, active and finished students, completion per
  lesson, the retention curve of each video, quiz pass rates and per-question results, and
  grades. The Students tab shows each student's progress.
- **Tests**:
  - API: 117 tests, including progress, quiz grading and attempt limits under parallel
    requests, assignment files, insights and notifications.
  - Worker: 20 tests, including who is notified, their choices, and email.
  - Web: 322 tests, including what counts as watched, resume points, quiz answers and the
    builder's checks, due dates, grades, file checks and notification updates.
- **Docs**: [ADR 8](docs/adr/0008-learning-progress.md), and the progress, quiz, assignment,
  notification and insight sections of the architecture page.

### Security
- **Quiz answers** never reach the page before they're earned, and attempt limits are enforced
  under an advisory lock.
- **Handed-in files** are uploaded under a signature that fixes their Content-Type, counted
  against the school's quota, and downloaded only as attachments, by the student or the course's
  editors.
- **Notifications** are readable only by their owner (row-level security). The worker writes them
  through a function that refuses anyone outside the event's school.
- **Database**: progress, attempts and submissions reference the lesson's course and school and
  the person's membership, so they can't cross schools, and go when the member leaves.

### Changed
- **Production settings**: the worker now needs `PUBLIC_WEB_URL`, for the links in emails. It's
  already in `infra/.env.prod` for the API.
- **Real-time**: role changes move a person's devices in or out of the staff room with a
  broadcast, so an API instance that's restarting can't make them fail.

## [7.0.0] - 2026-10-01

**Grand LMS, Phase 1: courses and video lessons.** Schools build courses from modules and
lessons, upload lesson videos straight to storage, and stream them back adaptively.

### Added
- **Courses**:
  - Courses with modules and lessons, as drafts until published. Owners and admins edit every
    course, instructors the ones they created, and members see what is published.
  - A catalog on each school's page: Continue learning, every course, and for editors their
    drafts and archived courses. Covers come from the first video, or are drawn from the title.
  - A course page with an outline, a Markdown description, and Enroll, Start or Continue.
  - Enrollments, and free preview lessons that play without one.
- **Course editor** at `/s/{school}/c/{course}/edit`:
  - Publish, unpublish, archive and restore.
  - An outline builder: add, rename and delete modules and lessons, and reorder them by drag
    and drop (pointer, touch or keyboard) or with move buttons, across modules too. One request
    saves the whole order.
  - A lesson drawer for the title, summary, Markdown notes, the Published and Free preview
    switches, and the video.
  - The school's video storage: used, reserved and the quota.
- **Video uploads**:
  - Straight from the browser to S3-compatible storage, in 16 MiB parts, three at a time, with
    retries. Speed and time left are shown, and uploads keep going while you move around the app.
  - Each school has a storage quota (2 GiB by default). An upload reserves its size when it
    starts.
  - The worker transcodes with ffmpeg to HLS in every quality up to the source's (1080p to
    360p), and makes a poster and a storyboard for scrubbing previews. Progress shows live.
  - A file that isn't a video, or is too long, fails with a reason, and its space is freed.
- **Lessons can embed** a YouTube, Dailymotion or Twitch video instead.
- **Lesson page**:
  - A player built on hls.js: quality (Auto or a fixed rendition), speed, picture in picture,
    full screen, keyboard shortcuts, and thumbnails over the seek bar.
  - The course outline beside the video, with notes, previous and next, and an Up next
    countdown.
  - Expired video links are renewed without losing your place.
- **Storage**: Garage, a small self-hosted S3-compatible store, locally and on the server.
  `npm run storage:setup` gets a bucket ready.
- **Tests**:
  - API: 86 tests, including courses, permissions, outlines, uploads, quotas and signed
    playback.
  - Worker: 12 tests, transcoding real clips with ffmpeg.
  - Web: 256 tests.
  - CI runs Garage and ffmpeg, and transcodes test clips inside the worker image.
- **Docs**: [ADR 7](docs/adr/0007-video-pipeline.md) on storage, transcoding and playback, plus the
  courses and video sections of the architecture page.

### Security
- **Private bucket**: every upload part, segment, poster and sprite is a presigned URL that
  expires.
- **Playlist tokens**: playlists need an HMAC token, signed for one video under a key of its own,
  and issued only after the enrollment check.
- **Database**: new tables are separated by row-level security. Composite keys stop a lesson
  pointing at another school's course, or at another course's module.
- **Real-time**: video progress goes to a school's staff room (instructors and above) only, and
  follows role changes.
- **Course text**: Markdown is rendered with raw HTML dropped. Images become links, and external
  links open in a new tab with `noopener`.

### Changed
- **Production settings** (breaking): the server now also runs Garage and serves it at
  `MEDIA_DOMAIN`. `infra/.env.prod` needs `MEDIA_DOMAIN`, `GARAGE_RPC_SECRET`,
  `GARAGE_ADMIN_TOKEN`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, and Netlify needs
  `MEDIA_ORIGIN` (see docs/deploy.md).
- **Worker image**: it ships ffmpeg and transcodes on a volume.
- **School page**: the Overview tab is now Courses.

## [6.0.0] - 2026-09-30

**Grand LMS, Phase 0.** The video app becomes the foundation of a learning platform for many
schools, with its own backend. The video pages stay, as Explore.

### Added
- **Monorepo** (npm workspaces):
  - `apps/web`: the React app, moved here.
  - `apps/api`: NestJS 12 on Fastify.
  - `apps/worker`: NestJS with BullMQ.
  - `packages/contracts`: zod schemas and types shared by all three.
- **Accounts**:
  - Sign up and sign in with Argon2id passwords.
  - 15-minute access tokens, kept in memory.
  - Single-use refresh tokens in an httpOnly cookie. Reusing one ends the session.
  - A list of signed-in devices, with remote sign-out.
  - A 15-minute lock after 10 failed logins.
- **Schools**:
  - Creating a school makes you its owner.
  - Each school has a public page at `/s/{school}`.
  - Roles: owner, admin, instructor, student. People manage only the roles below their own.
  - Members can leave, and admins can remove people.
- **Invitations**:
  - Email invitations: single-use, valid for 7 days, and only for the invited address.
  - Inviting again replaces the old link.
  - The link travels in the URL fragment, so it never reaches a server log.
- **Real-time**:
  - Socket.IO with single-use sign-in tickets.
  - School rooms with presence and member events.
  - Devices signed out elsewhere disconnect instantly.
  - The Redis adapter lets it run on several instances.
- **Background jobs**:
  - A transactional outbox, relayed to BullMQ by LISTEN/NOTIFY with `SKIP LOCKED`.
  - Invitation emails over SMTP.
  - A nightly clean-up.
- **Operations**:
  - Liveness and readiness checks.
  - pino logs with request ids.
  - An OpenAPI document generated from the zod schemas.
  - Graceful shutdown.
  - Docker images, and Docker Compose for local development and for production (with Caddy).
- **Tests**:
  - 61 API tests and 5 worker tests against real Postgres and Redis, including row-level
    security straight against the database.
  - CI on GitHub Actions.
- **Docs**: architecture, six decision records, a free deployment guide (Netlify plus Oracle Cloud
  Always Free), and a roadmap.

### Security
- **School isolation**:
  - Postgres row-level security on every school-scoped table.
  - The API's database role owns nothing.
  - The audit log is append-only.
  - Invitations are looked up through a `SECURITY DEFINER` function.
- **Rate limits**: Redis sliding-window limits per person or per address, with `RateLimit-*` headers.
- **Requests**:
  - The API accepts JSON only, and validates every input against the shared schemas.
  - It sends one error shape, which never includes internals.
- **Headers**: the API sends strict headers of its own. The page's Content-Security-Policy moved
  from `netlify.toml` to `apps/web/config/headers.mjs`. It's written to `dist/_headers` at build
  time, so it can allow WebSockets to the API's host only.

### Changed
- The web app's security headers and the `/api/v1` proxy rule are generated by
  `apps/web/scripts/netlify-files.mjs` from `API_ORIGIN`.
- The video proxy function leaves `/api/v1/*` to the API.
- One `.env` at the repository root serves every app.

## [5.0.0] - 2026-09-29

A redesign and a security overhaul. The app now runs entirely on free services.

### Added
- **Streaming-service home**:
  - A full-width billboard of the top five trending videos, with cross-fades, a slow image drift, progress bars, swipe, arrows and a pause button. It pauses on hover and focus, and doesn't autoplay with reduced motion.
  - Rows for Continue watching, a numbered Top 10 today, More trending, and each category. Rows slide sideways with paging arrows, and each loads only when it scrolls near.
- **Browse pages** (`/browse/:slug`) with a sliding chip highlight. Old `/?c=` links redirect.
- **Motion**:
  - Page transitions, a top bar that floats over the billboard until you scroll, and cards that lift with a play button on hover.
  - Sliding nav and tab indicators, spring toasts and menus, and a save "pop".
  - It uses Motion, whose features are lazy-loaded after the first paint, and everything respects reduced motion.
- **Watch page**: ambient glow from the video's colors behind the player. "Play" from the billboard starts the video right away (`?play=1`).
- **New design**:
  - A calm "cinema" look built on design tokens, with dark and light themes (following the system until you pick one, applied before the first paint).
  - A sticky top bar on desktop and bottom tabs on phones replace the long sidebar.
  - Categories are chips with their own addresses (`/?c=music`), and a Sources menu picks the platforms.
- **Watch any platform in the app** (`/watch/:provider/:id`): YouTube, Dailymotion and Twitch clips.
  - The player is a poster until you press play: no third-party frame, script or cookie before that.
  - The page also has "Up next", a description with safe links, comments, share, save, and "Open on …".
- **Search**: recent searches as suggestions (keyboard-friendly combobox), the `/` shortcut, filters by platform, and a search screen on phones with recent searches and categories.
- **Library** (`/library`): saved videos and history, with remove and a two-step "Clear all". Kept in the browser only.
- **Channel page**: banner, stats, description, and "Load more" through the channel's uploads.
- **Error boundary, 404 page, and empty and error states**, each with a way forward.
- **API**:
  - One video shape for every platform.
  - `trending` endpoints (YouTube's popular chart costs no search), `related` for Dailymotion and Twitch, and Dailymotion routed through the proxy.
- **API proxy**: a Netlify Function at `/api/*` calls the official YouTube Data API v3, Dailymotion and Twitch Helix with server-side keys. RapidAPI is removed.
- **Mock mode**: `npm run dev:mock` / `preview:mock` run the app with no keys, against a realistic stand-in of the platforms.
- **Tests**: 103 Vitest tests for the proxy, client logic (source mixing and fallback, storage validation and migration, formatting) and security rules. ESLint 9.
- **App icons** and a web app manifest.

### Security
- **Content-Security-Policy**:
  - Scripts only from the app itself, plus the inline theme script by hash. No `eval`, and Trusted Types required.
  - API calls only to the site's own origin, images only from the platforms' image servers, frames only from their players, and the site can't be framed.
  - Also HSTS, COOP, CORP, `Permissions-Policy`, `Referrer-Policy` and `nosniff`. The preview server sends the same headers.
- **No keys in the browser**: the old RapidAPI key was bundled into the public JavaScript. It's gone, and all keys live on the server.
- **API**:
  - Routes are allow-listed, and unknown or repeated parameters are rejected.
  - Cross-site requests are refused before any quota is spent.
  - Cache keys use only real parameters, and upstream calls time out after 8 s.
  - Rate limited per IP, and errors never cached.
- **Untrusted data**:
  - HTML is stripped server-side and only https image URLs are passed on.
  - No raw HTML rendering.
  - Description links are limited to `http(s)` and opened with `noopener noreferrer`.
- **Local storage is validated on read**. Lists from the previous version are migrated once, and invalid entries dropped.
- **Dependencies updated**: React Router 7.18 fixes its published advisories, including an open redirect through `<Link>`. Vite 8 and Vitest 5 fix the dev-server advisories. `npm audit` reports 0 vulnerabilities.

### Changed
- **Real data only**:
  - Real durations, views, likes, subscriber counts and channel avatars, and decoded titles.
  - No fake verified badges, and no buttons that did nothing.
  - "Subscribe" opens YouTube's subscribe confirmation.
- **Free tiers**:
  - YouTube search results are cached for a day in Netlify's durable cache, and queries are lower-cased to share entries.
  - When YouTube's daily limit is reached, or no key is set, Dailymotion fills in with a note.
- **Performance**:
  - The home page ships with the app and requests its feed before rendering. Other pages load on demand.
  - Thumbnails are responsive and lazy loaded, and Inter is self-hosted.
  - `react-player` is removed: the main bundle is 101 KB gzipped (was 121 KB), even with Motion.
  - The carousel engine loads when the browser is idle, and billboard slides are built only when shown or next.
  - Rows below the first screen render after the first paint, and off-screen rows skip layout (`content-visibility`).
- **Accessibility**:
  - A skip link, and focus moves to the new page on navigation.
  - One h1 per page and an ordered outline.
  - Labelled controls, visible focus, contrast checked in both themes, and reduced-motion support.
- **Old addresses redirect**: `/video/:id`, `/search/:term`, `/history` and `/watch-later` lead to their new pages.

### Fixed
- **Page overflow**: `box-sizing` was misspelled in the reset, so every page was clipped on the right.
- **Watch history**: watching a second video wiped the history.
- **Saves didn't sync**: saving a video on one card didn't update the others.

### Deployment notes
- In Netlify, set `YOUTUBE_API_KEY` and, for Twitch clips, `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` (all free). Remove `VITE_RAPID_API_KEY`.
- Delete the old RapidAPI key, or cancel that subscription. It was public in the previous bundle.

---

## [4.0.0] - 2026-02-10

### Added
- **Multi-Provider Architecture**: Provider abstraction layer supporting YouTube, Twitch, and Dailymotion with normalized video shapes, `Promise.allSettled` parallel fetching, and round-robin interleaving.
- **Twitch Provider**: Search clips, get details, and fetch trending clips via RapidAPI Twitch wrapper (`twitchProvider.js`).
- **Dailymotion Provider**: Search, details, and related videos via Dailymotion's public data API — no OAuth required (`dailymotionProvider.js`).
- **YouTube Provider Wrapper**: Normalized adapter around existing `youtubeApi.js` service (`youtubeProvider.js`).
- **Provider Toggle UI**: "Platforms" section in Sidebar with branded toggle switches for YouTube/Twitch/Dailymotion. At least one provider must remain active.
- **Platform Badges**: Twitch (purple) and Dailymotion (blue) badges on video card thumbnails for non-YouTube content.
- **Platform Icons**: `YouTubeIcon`, `TwitchIcon`, `DailymotionIcon` SVG exports in `constants.jsx`.
- **`activeProviders` state**: New context value in `UIContext` with `toggleProvider` callback, defaulting to `['youtube']`.
- **Functional Share Button**: Web Share API integration with `navigator.clipboard.writeText` fallback; visual "Link copied!" feedback toast.
- **Collapsible Description**: Video descriptions default to 3-line truncation with "Show more" / "Show less" toggle button.

### Changed
- **Feed**: Uses `multiSearch(category, activeProviders)` via provider aggregator; re-fetches when toggled platforms change.
- **SearchFeed**: Routes through `multiSearch(searchTerm, activeProviders)` for cross-platform search results.
- **VideoCard**: Refactored to handle both raw YouTube items and normalized multi-provider items; external provider links open in new tabs.
- **Videos**: Detects normalized items by `provider` field and renders accordingly; legacy YouTube items handled with existing logic.
- **Hero**: Supports both normalized and raw YouTube video shapes for featured banner.
- **Sidebar**: Added platform icons import, `PROVIDERS`/`PROVIDER_LABELS` integration, and platforms toggle section between nav and footer.

### Fixed
- **Watch Later / History clear button**: Added `flex-wrap: wrap`, `gap: 1rem` to `.header`; `flex-shrink: 0` and `white-space: nowrap` to `.clearBtn` — button no longer overflows at intermediate viewport widths.
- **Share button**: Was a non-functional stub with no `onClick` handler — now fully operational.
- **Description overflow**: Was always fully expanded with no truncation — now collapsed by default with toggle.

---

## [3.0.0] - 2026-02-10

### Added
- **Watch Later / Favorites**: Full bookmark system with `useWatchLater` hook, localStorage persistence, toggle support, and dedicated `/watch-later` page.
- **Bookmark on VideoCard**: Hover-reveal bookmark button on video thumbnails with inline toast notifications ("Added/Removed from Watch Later").
- **Save button on VideoDetail**: "Save" / "Saved" toggle in the video action bar alongside Like and Share.
- **Video Comments Section**: New `Comments` component fetching real YouTube comment threads via `/commentThreads` API endpoint, with avatars, timestamps, like counts, skeleton loading, and error/empty states.
- **Functional Like Counter**: `useLikes` hook with localStorage persistence; like button toggles visual state (violet highlight, filled icon) and increments displayed count by 1.
- **Watch Later sidebar entry**: Bookmark icon category in sidebar navigating to `/watch-later`.
- **`getCommentThreads` API method**: New service function in `youtubeApi.js` for fetching video comments.
- **`BookmarkIcon` component**: Exported SVG icon with `filled` prop for outline/filled states.

### Changed
- **VideoDetail**: Integrated Comments section below description, functional like button replacing static stub, and Save/Watch Later button in action bar.
- **VideoCard**: Added `useWatchLater` integration with bookmark overlay, toast feedback, and `useState` for local toast state.
- **Sidebar**: Extended navigation logic to handle "Watch Later" route alongside "History".
- **App router**: Added `/watch-later` route.
- **Constants**: Added `BookmarkOutlineIcon`, `BookmarkIcon`, and "Watch Later" category entry.

---

## [2.1.0] - 2026-02-07

### Added
- **StreamVerse Theme**: Complete color palette overhaul — violet (`#8b5cf6`) / pink (`#ec4899`) gradient system replacing red/black.
- **Hero Component**: Featured video banner with gradient overlay, glassmorphism, and animated action button.
- **Hexagonal Shield Logo**: Custom SVG logo with streaming signal arcs in violet-pink gradient.
- **Sidebar Toggle**: Collapsible sidebar with smooth width transition and icon-only collapsed state.
- **Glass morphism mixins**: `glass()` and `text-gradient` SCSS mixins for premium UI effects.

### Changed
- **Architecture Overhaul**: Merged Logo + Sidebar into a single fixed entity; Navbar became content-only top bar; removed `PageLayout` component.
- **Layout System**: New `mainAPI-layout` / `mainContent-area` CSS classes with `margin-left` transition for sidebar collapse.
- **Video Grid**: Simplified to `repeat(auto-fill, minmax(280px, 1fr))` with `overflow-x: hidden` to prevent right-edge card clipping.
- **Sidebar Styles**: Full rewrite with proper `.collapsed` state, hiding labels/brand/footer.
- **Navbar Styles**: Stripped to transparent background with search + action buttons only.
- **VideoCard Styles**: 16px border-radius, gradient avatar fallback with channel first-letter, `box-shadow` enhancements.

### Fixed
- SCSS brace mismatch in `Sidebar.module.scss` (`.navList` missing closing `}`).
- Right-side video cards clipping — added `overflow-x: hidden` and `max-width: 100%` to `.page-content`.
- 4px icon alignment discrepancy between Navbar menu icon and Sidebar category icons.
- Navbar/Sidebar border intersection at corner using `::after` pseudo-element (later removed with architecture change).

---

## [2.0.0] - 2026-02-04

### Added
- **Watch History**: Tracking system using `localStorage` and custom `useWatchHistory` hook.
- **History Page**: User-centric dashboard for recently viewed videos.
- **SCSS 7-1 Architecture**: Professional styling structure with global variables, mixins, and theme tokens.
- **Vite 5 & React 19**: Modernized build system and framework.
- **VideoSkeleton**: Custom loading states for improved UI/UX.
- **Environment Support**: Added `.env.example` for secure API key management.

### Changed
- **Style Overhaul**: Removed Material UI (MUI) in favor of high-performance SCSS Modules.
- **Architecture**: Refactored to a page-based routing structure ([src/pages/](src/pages/)).
- **Icons**: Switched from `@mui/icons-material` to optimized custom SVG components.
- **Data Fetching**: Upgraded to TanStack Query (React Query) v5 for superior state management.
- **Asset Management**: Migrated `constants.js` to `constants.jsx` to support React-based metadata.

### Fixed
- Resolved Sass "Undefined variable" errors by using explicit `@use` declarations and updated `vite.config.js`.
- Fixed JSX parsing errors in `constants.jsx` (broken SVG paths).
- Corrected API response normalization for `VideoCard` to handle `/search` and `/videos` endpoints consistently.

---

## Commits

| Commit | Description | Files |
| :--- | :--- | :--- |
| `192feb7` | Infrastructure: Vite 5, React 19, and directory refactor | `vite.config.js`, `index.html`, `package.json`, `src/app/*` |
| `1853701` | Core: SCSS 7-1 setup, modern API services, and JSX constants | `src/styles/*`, `src/services/*`, `src/utils/constants.jsx` |
| `f1269b7` | Components: Premium SCSS Modules refactor and MUI removal | `src/components/*`, `src/pages/*` |
| `299564b` | Feature: Watch History implementation and persistent storage | `src/hooks/useWatchHistory.js`, `src/pages/History.*` |
| `fa9878c` | Style: Remaining page-level SCSS modules for Feed and Search | `src/pages/*.module.scss` |
| `2a168da` | Chore: Update .gitignore for Vite build output | `.gitignore` |
| `fea8a0b` | Docs: Finalize changelog with commit mapping | `CHANGELOG.md` |
| `4e264aa` | Docs: Include final styling modules in changelog | `CHANGELOG.md` |
| `8a4ab0c` | Security: Remove .env from version control | `.env` |
| `54e99b3` | Docs: Sync changelog with recent security and style commits | `CHANGELOG.md` |
| `61d187f` | Deployment: Add netlify.toml config for Vite | `netlify.toml` |
| `28044e9` | Docs: Update changelog with Netlify fix | `CHANGELOG.md` |
| `323d595` | Fix: Robust API key retrieval via Axios interceptors | `src/services/youtubeApi.js` |
| `187a526` | Fix: Refactor env key access for Netlify resilience | `src/services/youtubeApi.js` |
| `742cf66` | Layout: Global fixed sidebar with independent scrolling | `src/components/PageLayout.*` |
| `9afa5be` | Docs: Include sidebar layout in changelog | `CHANGELOG.md` |
| `f0c7280` | UI: Revamp layout with Sidebar, Hero, premium styles | `src/components/*`, `src/pages/*`, `src/styles/*` |
| `2cc8457` | UI: Enhanced grid layout and hexagonal shield logo | `src/components/*`, `src/utils/constants.jsx` |
| `8cffad6` | Feature: Watch Later, Comments, Like counter (v3.0.0) | `src/hooks/*`, `src/pages/WatchLater.jsx`, `src/components/Comments.*` |
| `32a2435` | Feature: Multi-provider architecture + bug fixes (v4.0.0) | `src/services/providers/*`, `src/components/*`, `src/pages/*`, `src/context/*` |
| `2dca7cc` | Docs: Update CHANGELOG with v3.0.0 and v4.0.0 | `CHANGELOG.md` |

# FundaStream

A calm, fast video app that brings YouTube, Dailymotion and Twitch clips together in one feed. Browse trending videos and categories, search across platforms, and watch everything in the app. Save videos for later, and pick up where you left off.

Live: https://funda-streamvideos.netlify.app

## Features

- **Streaming-service home**:
  - A full-width **billboard** of the top five trending videos: they cross-fade, the image drifts slowly, and progress bars show the next slide. You can swipe it, use the arrows, or press pause. It pauses on hover and focus, and doesn't autoplay with "reduce motion".
  - Rows below: **Continue watching**, a numbered **Top 10 today**, **More trending**, and a row per category.
  - Rows slide sideways, with paging arrows and soft edges, and each one loads only when it scrolls near.
- **One feed, three platforms**: YouTube, Dailymotion and Twitch clips mixed together. The **Sources** menu in the top bar picks which platforms to show.
- **Browse** (`/browse/music`): each category gets its own page, with chips whose highlight slides from one to the next.
- **Watch in the app**: every platform plays on the watch page, with ambient light from the video's colors glowing behind the player.
  - The player loads only when you press play, so no third-party cookies are set until then. "Play" on the billboard starts the video right away.
  - Up next, description, comments (YouTube) and channel details sit alongside.
- **Motion that stays out of the way**:
  - Pages fade in, the top bar floats over the billboard until you scroll, and cards lift and show a play button on hover.
  - Tabs have sliding indicators, and toasts and menus spring into place.
  - It's all built with [Motion](https://motion.dev/), which loads after the first paint, and all of it follows "reduce motion".
- **Search**: recent searches, the `/` shortcut to jump to the field, results filtered by platform, and a full search screen on phones.
- **Library**: saved videos and watch history, kept in this browser only.
- **Dark and light themes**, following your system until you pick one. The billboard stays cinematic in both.
- **Works on any screen**: top bar on desktop, bottom tabs on phones.
- **Accessible**: keyboard shortcuts and visible focus, a skip link, one heading outline per page, labelled controls, and contrast checked in both themes.

## Tech stack

- **UI**: [React 19](https://react.dev/), [React Router 7](https://reactrouter.com/), Sass modules on CSS-variable design tokens, self-hosted Inter
- **Motion and carousels**: [Motion](https://motion.dev/) (animation features lazy-loaded) and [Embla](https://www.embla-carousel.com/) for the billboard (loaded when the browser is idle), both styled with SCSS
- **Data**: [TanStack Query v5](https://tanstack.com/query) in the browser, a [Netlify Function](https://docs.netlify.com/functions/overview/) as the API proxy
- **Video APIs** (all free): [YouTube Data API v3](https://developers.google.com/youtube/v3), [Dailymotion](https://developers.dailymotion.com/api/) (no key), [Twitch Helix](https://dev.twitch.tv/docs/api/) (clips)
- **Tooling**: [Vite 8](https://vitejs.dev/), ESLint 9, [Vitest](https://vitest.dev/)

## How it fits together

```text
browser ──► /api/youtube/*      ─┐
         ──► /api/dailymotion/*  ─┼─► Netlify Function (netlify/functions/api.mjs)
         ──► /api/twitch/*       ─┘     checks the request, adds keys, returns one video shape,
                                        caches the answer at the CDN
                                    ├─► www.googleapis.com/youtube/v3  (YOUTUBE_API_KEY)
                                    ├─► api.dailymotion.com            (no key)
                                    └─► api.twitch.tv/helix            (TWITCH_CLIENT_ID / SECRET)
```

The browser only ever talks to its own site: every video request goes through `/api`, and the keys stay on the server. Players are embedded from each platform's own player domain.

```text
server/api/        the proxy: router, one module per platform, the shared video shape, HTTP helpers
netlify/functions  the Netlify entry point for /api/*
src/
  app/             routes and layout (skip link, focus on navigation, error boundary)
  pages/           Home, Browse, Watch, Search, Channel, Library, NotFound
  components/      UI pieces, each with its SCSS module
  lib/             API client, data loading, stores (library, preferences), formatting
  styles/          design tokens (colors, type, spacing for both themes), base styles, mixins
tests/             Vitest: the proxy (against a mock of the platforms), client logic, security rules
```

### The API proxy

Every endpoint returns videos in one shape (`server/api/video.mjs`): provider, id, title, plain-text description, thumbnails, channel, date, views, likes, duration in seconds, and whether it's live. Nothing else leaves the server.

| Endpoint | What it does | CDN cache |
| --- | --- | --- |
| `youtube/trending` | YouTube's most-popular chart (1 unit, no search) | 6 h |
| `youtube/search?q=` | Search, with durations and views | 24 h |
| `youtube/video?id=` | One video, with the channel's avatar and subscribers | 1 h |
| `youtube/related?id=` | More from the same channel (uploads playlist) | 1 h |
| `youtube/channel?id=` / `channel-videos?id=&pageToken=` | Channel page and its videos | 6 h / 1 h |
| `youtube/comments?id=` | Top comments, plain text | 1 h |
| `dailymotion/trending`, `search?q=`, `video?id=`, `related?id=` | Same set for Dailymotion (family filter on) | 1–6 h |
| `twitch/trending`, `search?q=`, `clip?id=`, `related?id=` | Clips: top game's, a search's, one, or the same streamer's | 1–6 h |

## Security

- **Strict Content-Security-Policy** (`netlify.toml`):
  - Only the app's own scripts run, plus one inline theme script allowed by its hash.
  - No `eval`, and Trusted Types are required for any DOM script sink.
  - The page may only call its own API, show images from the platforms' image servers, and frame their players.
  - It can't itself be framed.
- **More headers**: HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy`. `npm run preview` serves the same headers, so they're tested locally.
- **API hardening**:
  - Only the listed endpoints exist. Unknown or repeated parameters are rejected, and ids and queries are validated.
  - Requests from other websites (`Sec-Fetch-Site: cross-site`) are refused before any quota is spent.
  - The CDN cache key uses only the parameters an endpoint reads, so made-up parameters can't bypass the cache.
  - Upstream calls time out after 8 seconds, and each IP gets 120 requests a minute.
  - Errors are never cached and never include keys or upstream URLs.
- **Untrusted data stays text**:
  - The server strips HTML from titles and descriptions and only passes https image URLs.
  - React escapes everything else, and no component renders raw HTML.
  - Description links become links only when they are `http(s)`, and open with `noopener noreferrer`.
- **Local storage is validated**: Library entries are checked field by field when read back (platform, id format, https images, lengths), so edited or stale data can't break or inject anything.
- **Dependencies**: `npm audit` reports 0 vulnerabilities.
- **Guardrails**: `tests/security.test.mjs` fails the build if the CSP loses its guarantees, the inline script's hash drifts, a key or third-party API call appears in browser code, raw HTML rendering is introduced, or a new-tab link lacks `noopener`.

## What it costs: $0

Every service here has a free tier that needs no credit card. None of them can bill you: when a limit is reached, that service pauses or says no until it resets.

| Service | Free tier | How the app stays inside it |
| --- | --- | --- |
| YouTube Data API v3 | 100 searches a day, plus 10,000 units a day for everything else | "Trending" uses the popular chart (no search). A search or category is cached for 24 hours in Netlify's shared (durable) cache, so it costs at most one search a day, however many people open it. Queries are lower-cased to share entries. Watch pages, channels and "Up next" use the 10,000-unit budget (1 to 3 units each). |
| Dailymotion | Free, no key | Cached 1 to 6 hours. |
| Twitch Helix | Free, rate limited per minute | Cached 1 to 6 hours. |
| Netlify Free plan | 300 credits a month, a hard cap (the site pauses, you are never charged) | Cached API responses don't run the function. Most credits go to production deploys, so batch changes into fewer deploys. |

If YouTube's searches run out for the day, or no YouTube key is set, the feed and search show Dailymotion videos instead, with a short note. YouTube resets at midnight Pacific time. Google also raises the quota for free on request (YouTube API Services audit form).

## Getting started

```bash
npm install
npm run dev:mock   # runs with a built-in stand-in of the APIs, no keys needed
```

To use the real APIs, copy `.env.example` to `.env` and fill it in:

| Variable | Where to get it | Required |
| --- | --- | --- |
| `YOUTUBE_API_KEY` | Google Cloud Console → enable *YouTube Data API v3* → Credentials → API key (restrict it to that API). No billing account needed. | for YouTube (without it, Dailymotion fills in) |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | [dev.twitch.tv/console](https://dev.twitch.tv/console) → Register an application (free) | for Twitch clips |

Then `npm run dev`. The dev server answers `/api/*` with the same code Netlify runs. The variables have no `VITE_` prefix on purpose: Vite only bundles `VITE_*` variables into the browser code.

On Netlify, set the same variables under **Site configuration → Environment variables**. `netlify.toml` already sets the build, the function and the security headers.

If you change the inline script in `index.html`, update its hash in the CSP in `netlify.toml`. `npm test` prints the expected hash when they don't match.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `dev:mock` | Dev server with real APIs, or with the mock |
| `npm run build` | Production build into `dist/` |
| `npm run preview` / `preview:mock` | Serve the build locally, with `/api` and the production security headers |
| `npm run lint` | ESLint |
| `npm test` | Vitest |

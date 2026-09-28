# FundaStream

A video streaming front end that brings YouTube, Twitch and Dailymotion together in one feed: search, watch, comments, channels, watch history and a watch-later list.

Live: https://funda-streamvideos.netlify.app

## Tech stack

- **UI**: [React 19](https://react.dev/), [React Router 7](https://reactrouter.com/), Sass (SCSS modules, 7-1 layout), self-hosted Inter
- **Data**: [TanStack Query v5](https://tanstack.com/query) in the browser, a [Netlify Function](https://docs.netlify.com/functions/overview/) as the API proxy
- **Video APIs**: [YouTube Data API v3](https://developers.google.com/youtube/v3), [Twitch Helix](https://dev.twitch.tv/docs/api/) (clips), [Dailymotion](https://developers.dailymotion.com/api/) (public, no key)
- **Tooling**: [Vite 5](https://vitejs.dev/), ESLint 9, [Vitest](https://vitest.dev/)

## How it fits together

```text
browser ──► /api/youtube/*  ─┐
         ──► /api/twitch/*   ─┼─► Netlify Function (netlify/functions/api.mjs)
                              │     validates input, adds the keys, caches at the CDN
                              ├─► www.googleapis.com/youtube/v3   (YOUTUBE_API_KEY)
                              └─► api.twitch.tv/helix             (TWITCH_CLIENT_ID / SECRET)
browser ──► api.dailymotion.com  (public API, called directly)
```

The API keys only exist on the server. The browser calls same-origin `/api/...` endpoints and never sees a key.

```text
server/api/       # the proxy: router, YouTube and Twitch clients, HTTP helpers (shared by Netlify and Vite)
netlify/functions # the Netlify entry point for /api/*
src/
  app/            # routes (each page is a lazily loaded chunk) and providers
  components/     # UI pieces with SCSS modules
  context/        # UI state (category, platforms, sidebar)
  hooks/          # watch history, watch later, likes (localStorage)
  pages/          # Feed, Search, Video, Channel, History, Watch Later
  services/       # /api client and the per-platform providers
  styles/         # variables, mixins, reset, typography
  utils/          # formatting (durations, counts, thumbnails) and constants
tests/            # Vitest: the proxy (with a mock of the upstream APIs) and the formatters
```

### The API proxy

| Endpoint | Upstream | CDN cache |
| --- | --- | --- |
| `GET /api/youtube/search?q=` | `search.list` + `videos.list` (durations, views) | 24 h |
| `GET /api/youtube/video?id=` | `videos.list` + `channels.list` (subscriber count) | 1 h |
| `GET /api/youtube/related?id=` | the channel's uploads playlist | 1 h |
| `GET /api/youtube/channel?id=` | `channels.list` | 6 h |
| `GET /api/youtube/channel-videos?id=` | the channel's uploads playlist | 1 h |
| `GET /api/youtube/comments?id=` | `commentThreads.list` (plain text) | 30 min |
| `GET /api/twitch/search?q=` | game or channel lookup, then its top clips | 30 min |
| `GET /api/twitch/trending` | top games, then their clips of the week | 30 min |
| `GET /api/twitch/clip?id=` | `clips` | 1 h |

- Only these routes exist, and every parameter is checked (video and channel ID formats, query length, page tokens).
- Responses are cached in Netlify's durable CDN cache, which every edge location shares, so each URL reaches YouTube or Twitch at most once per cache period.
- The function is rate limited per IP (120 requests a minute).
- A used-up quota comes back as `429` with a readable message and is never cached.

## What it costs: $0

Every service here has a free tier that needs no credit card. None of them can bill you: when a limit is reached, that service pauses or says no until it resets.

| Service | Free tier | How the app stays inside it |
| --- | --- | --- |
| YouTube Data API v3 | 100 searches a day, plus 10,000 units a day for everything else | A search (a category or a query) is cached for 24 hours, so it costs at most one search a day, however many people open it. Queries are lower-cased so "React" and "react" share one entry. Watch pages, channels and "Up next" use the 10,000-unit budget (1 to 3 units each). |
| Twitch Helix | Free, rate limited per minute | Cached 30 minutes to 1 hour. |
| Dailymotion | Free, no key | Called directly from the browser. |
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
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | [dev.twitch.tv/console](https://dev.twitch.tv/console) → Register an application (free) | for Twitch |

Then `npm run dev`. The dev server answers `/api/*` with the same code Netlify runs. The variables have no `VITE_` prefix on purpose: Vite only bundles `VITE_*` variables into the browser code.

On Netlify, set the same variables under **Site configuration → Environment variables**. `netlify.toml` already sets the build, the function and the security headers.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `dev:mock` | Dev server with real APIs, or with the mock |
| `npm run build` | Production build into `dist/` |
| `npm run preview` / `preview:mock` | Serve the build locally, `/api` included |
| `npm run lint` | ESLint |
| `npm test` | Vitest |

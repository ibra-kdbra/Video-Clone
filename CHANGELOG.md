# Changelog

All notable changes to this project will be documented in this file.

## [5.0.0] - 2026-09-29

A redesign and a security overhaul. The app now runs entirely on free services.

### Added
- **New design**:
  - A calm "cinema" look built on design tokens, with dark and light themes (following the system until you pick one, applied before the first paint).
  - A sticky top bar on desktop and bottom tabs on phones replace the long sidebar.
  - Categories are chips with their own addresses (`/?c=music`), and a Sources menu picks the platforms.
- **Home**: a featured spotlight video, "Continue watching", and a grid that shows 24 videos with "Show more".
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
  - `react-player` is removed: the main bundle is 85 KB gzipped (was 121 KB).
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

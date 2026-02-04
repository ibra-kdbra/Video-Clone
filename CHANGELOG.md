# Changelog

All notable changes to this project will be documented in this file.

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
| `f1269b7` | Components: Premium SCSS Modules refactor and MUI removal | `src/components/*`, `src/pages/*` (Feed, Details) |
| `299564b` | Feature: Watch History implementation and persistent storage | `src/hooks/useWatchHistory.js`, `src/pages/History.*` |
| `fa9878c` | Style: Remaining page-level SCSS modules for Feed and Search | `src/pages/*.module.scss` |
| `2a168da` | Chore: Update .gitignore for Vite build output | `.gitignore` |
| `fea8a0b` | Docs: Finalize changelog with commit mapping | `CHANGELOG.md` |
| `4e264aa` | Docs: Include final styling modules in changelog | `CHANGELOG.md` |
| `8a4ab0c` | Security: Remove .env from version control | `.env` |

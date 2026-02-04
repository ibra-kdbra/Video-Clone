# FundaStream Premium
An elevated video streaming platform re-engineered for performance and professional-grade UI/UX.

## Core Software Engineering Upgrade
This project has been fully refactored from a legacy Create React App template into a modern, high-performance architecture.

### Tech Stack
- **Framework**: [React 19](https://react.dev/) (Concurrent rendering, improved hooks)
- **Build Tool**: [Vite 5+](https://vitejs.dev/) (Instant HMR, esbuild-powered)
- **Styling**: [Sass (SCSS)](https://sass-lang.com/) with a 7-1 architecture pattern and SCSS Modules.
- **Data Layer**: [TanStack Query v5](https://tanstack.com/query) (Intelligent caching, background refetching, 1m staleTime)
- **Routing**: [React Router 7](https://reactrouter.com/)
- **API**: YouTube v3.1 via RapidAPI

### Features
- 🚀 **Performance**: Optimized rendering with React 19 and Vite.
- 🎨 **Professional UI**: Fully custom SCSS styling (no generic MUI layouts).
- 📱 **Responsive Design**: Mobile-first approach with custom mixins.
- 🕒 **Watch History**: LocalStorage-based persistence to track your viewed content.
- 🔍 **Advanced Search**: Intelligent search with debouncing and clear state.
- 🦴 **Skeleton Loaders**: Custom animated skeletons for all viewports.

## Architecture
```text
src/
  app/       # Routing and Global Providers
  components/# Modular UI elements (SCSS Modules)
  hooks/     # Custom logic (History, API abstractions)
  pages/     # Full-page views
  services/  # API clients and query logic
  styles/    # Global variables, mixins, and reset
  utils/     # Constants and helpers
```

## Getting Started
1. **Clone & Install**
   ```bash
   npm install
   ```

2. **Environment**
   Create a `.env` file with your RapidAPI key:
   ```env
   VITE_RAPID_API_KEY=your_key_here
   ```

3. **Launch**
   ```bash
   npm run dev
   ```

## Development Patterns
- **DRY Styling**: Global variables and mixins used via `additionalData` in Vite.
- **SOC**: Separation of concerns between API logic (`services/`) and UI components.
- **State Management**: Zero global state boilerplate by leveraging React Query for server data.

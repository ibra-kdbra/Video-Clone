/**
 * Demo mode: the whole LMS running in the browser against a mock of the API (src/demo), turned on
 * at build time with VITE_DEMO=true (the public site has no API server). The flag is a constant
 * the build replaces, so with it off every `if (DEMO)` branch, and the dynamic import below, is
 * dropped from the bundle; with it on, the mock is still its own chunk, loaded on first use.
 */
export const DEMO = import.meta.env.VITE_DEMO === 'true';

let loaded = null;

/** The mock API (src/demo/server.js), loaded once. Only defined in demo builds. */
export const loadDemo = DEMO
  ? () =>
      import('../demo/server.js').then((module) => {
        loaded = module;
        return module;
      })
  : null;

/** The mock API if it has loaded already (it has, once any request has gone through it), else null. */
export const loadedDemo = () => loaded;

// Single source of truth for the app version.
// IMPORTANT: when you change APP_VERSION, also change VERSION at the top of sw.js
// (the service worker cannot import ES modules in all browsers, so both must be bumped together).
export const APP_VERSION = '0.2.0';

// Version of the data layout (IndexedDB stores and backup CSV columns).
export const SCHEMA_VERSION = 1;

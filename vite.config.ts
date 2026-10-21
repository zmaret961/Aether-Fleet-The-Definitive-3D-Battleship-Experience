/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const APP_DESCRIPTION =
  'Sink the Legacy Monolith. A cinematic 3D Battleship field exercise starring a fleet of Devin agents — playable offline, on any screen.';

/** Groups vendor code into long-lived, cache-friendly chunks. Anything only
 * reachable from the lazily imported 3D scene stays off the critical path. */
function vendorChunk(id: string): string | undefined {
  // Rollup would otherwise hoist these tiny shared helpers into a 3D chunk,
  // making the entry statically import (and preload) three.js.
  if (id.includes('vite/preload-helper') || id.includes('commonjsHelpers')) return 'react';
  if (!id.includes('node_modules')) return undefined;
  if (/node_modules\/three\//.test(id)) return 'three';
  if (/node_modules\/(postprocessing|@react-three\/postprocessing|n8ao)\//.test(id)) return 'postfx';
  if (/node_modules\/(@react-three\/(fiber|drei)|its-fine|suspend-react|react-use-measure)\//.test(id)) return 'r3f';
  if (/node_modules\/(framer-motion|motion-dom|motion-utils)\//.test(id)) return 'motion';
  // zustand is shared by the app store and R3F; keep it with React so the shell
  // never statically pulls in the 3D chunks.
  if (/node_modules\/(react|react-dom|scheduler|zustand|use-sync-external-store)\//.test(id)) return 'react';
  return undefined;
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        id: '/',
        name: 'Aether Fleet — 3D Battleship',
        short_name: 'Aether Fleet',
        description: APP_DESCRIPTION,
        lang: 'en',
        dir: 'ltr',
        theme_color: '#04101e',
        background_color: '#04101e',
        display: 'standalone',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'any',
        scope: '/',
        start_url: '/?source=pwa',
        categories: ['games', 'entertainment'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        screenshots: [
          {
            src: 'screenshots/battle-wide.jpg',
            sizes: '1600x1000',
            type: 'image/jpeg',
            form_factor: 'wide',
            label: 'Dual-board battle against the Legacy Monolith',
          },
          {
            src: 'screenshots/battle-narrow.jpg',
            sizes: '780x1688',
            type: 'image/jpeg',
            form_factor: 'narrow',
            label: 'Full battle on a phone, one-thumb targeting',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        // Store screenshots and the social card are for installers/scrapers, and
        // extended Inter subsets only load on demand (runtime-cached below).
        globIgnores: ['**/screenshots/**', '**/og-image.png', '**/inter-{latin-ext,cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff2'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'font',
            handler: 'CacheFirst',
            options: { cacheName: 'aether-fonts', expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'aether-images', expiration: { maxEntries: 24 } },
          },
        ],
      },
      // A dev service worker caches stale modules and fights HMR; test the
      // PWA with `npm run build && npm run preview` instead.
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    // three.js alone is ~650 kB minified; it is lazy-loaded behind the UI shell.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

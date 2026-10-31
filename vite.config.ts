import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// On GitHub Pages the app lives under /<repo>/. Override with BASE_PATH if needed.
const base = process.env.BASE_PATH ?? './';

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev') },
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Booked — home library',
        short_name: 'Booked',
        description: 'Catalogue your books across flats, rooms and shelves.',
        theme_color: '#1f2a37',
        background_color: '#f7f5f0',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'],
        // The barcode decoder (WASM, ~1 MB) is precached so scanning works offline on iOS too.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: 'index.html',
        // The privacy policy is its own page (linked from Google's sign-in screen).
        navigateFallbackDenylist: [/privacy\.html$/],
        // Covers are not cached here: the app keeps resized copies in its own cover cache, and an
        // opaque service-worker copy would block reading their colours.
        runtimeCaching: [
          {
            // Map tiles: keep what you've looked at for offline use (bounded, per OSM tile policy).
            urlPattern: ({ url }) => url.hostname === 'tile.openstreetmap.org',
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'worker/**/*.test.ts']
  },
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined
});

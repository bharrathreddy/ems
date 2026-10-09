import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const APP_VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'School Office',
        short_name: 'School',
        theme_color: '#1F5F4A',
        background_color: '#F6F7F4',
        display: 'standalone',
        start_url: '/app/',
        scope: '/',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      workbox: { navigateFallbackDenylist: [/^\/api/, /^\/robots\.txt$/, /^\/sitemap\.xml$/], maximumFileSizeToCacheInBytes: 3 * 1024 * 1024 },
    }),
  ],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
});

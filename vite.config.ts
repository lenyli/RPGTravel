import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_NAME, APP_SHORT_NAME } from './src/config';

const configured = process.env.DEPLOY_BASE || '/';
const base = `/${configured.split('/').filter(Boolean).join('/')}${configured === '/' ? '' : '/'}`;
export default defineConfig({
  base,
  plugins: [
    react(),
    {
      name: 'app-metadata',
      transformIndexHtml: (html) => ({
        html: html.replace(
          /<title>.*?<\/title>/,
          () =>
            `<title>${APP_NAME.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</title>`,
        ),
        tags: [
          {
            tag: 'meta',
            attrs: {
              name: 'rpg-build',
              content: process.env.APP_BUILD || '2.0.0',
            },
            injectTo: 'head',
          },
        ],
      }),
    },
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png'],
      manifest: {
        id: base,
        name: APP_NAME,
        short_name: APP_SHORT_NAME,
        description: '将真实旅途化为故事，本机保存，离线继续。',
        lang: 'zh-CN',
        start_url: `${base}#/`,
        scope: base,
        display: 'standalone',
        theme_color: '#234d3c',
        background_color: '#f5f2e9',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        cacheId: `rpg-trip-${base.replace(/[^a-z0-9]/gi, '_')}`,
        globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/api\//],
        cleanupOutdatedCaches: false,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: { outDir: process.env.BUILD_OUT_DIR || 'dist' },
});

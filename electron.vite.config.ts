import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'electron-vite';
import { notices } from './scripts/notices-plugin.ts';

const shared = resolve(import.meta.dirname, 'src/shared');
const renderer = (file: string): string => resolve(import.meta.dirname, 'src/renderer', file);

function buildTime(): string {
  const epoch = Number(process.env.SOURCE_DATE_EPOCH);
  return new Date(Number.isFinite(epoch) && epoch > 0 ? epoch * 1000 : Date.now()).toISOString();
}

const windowReports = JSON.stringify(process.env.MCMONITOR_WINDOW_REPORTS ?? '');

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    plugins: [notices('main')],
    build: { externalizeDeps: false },
    define: {
      __LAUNCHER_BUILT_AT__: JSON.stringify(buildTime()),
      __TELEMETRY_BEHAVIOR__: JSON.stringify(process.env.MCMONITOR_TELEMETRY_BEHAVIOR ?? ''),
      __WINDOW_REPORTS__: windowReports,
      __MS_CLIENT_ID__: JSON.stringify(process.env.MCMONITOR_MS_CLIENT_ID ?? ''),
    },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    plugins: [notices('preload')],
    build: {
      externalizeDeps: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    resolve: { alias: { '@shared': shared } },
    // Vite's default 5173 collides with other local dev servers; a fixed, less common port avoids that.
    server: { port: 5190, strictPort: true },
    plugins: [vue(), notices('renderer')],
    build: {
      minify: true,
      assetsInlineLimit: 0,
      rollupOptions: {
        input: {
          index: renderer('index.html'),
          ...(process.env.VITE_DEMO === '1' && { demo: renderer('demo.html') }),
        },
      },
    },
    define: {
      __WINDOW_REPORTS__: windowReports,
      __VUE_OPTIONS_API__: 'false',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
  },
});

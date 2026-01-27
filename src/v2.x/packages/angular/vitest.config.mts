/// <reference types="vitest" />
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const r = (...p: string[]) => resolve(__dirname, ...p);

export default defineConfig(({ mode }) => ({
  plugins: [angular()],
  resolve: {
    dedupe: [
      '@angular/core',
      '@angular/common',
      '@angular/platform-browser',
      '@angular/platform-browser-dynamic',
      '@angular/compiler',
      '@angular/core/testing',
    ],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [r('src/test-setup.ts')], // Use absolute path
    include: ['src/**/*.{spec,test}.{ts,tsx}'],
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '*.config.*',
        'src/test-setup.ts',
        'src/index.ts',
        'src/public-api.ts',
      ],
    },
  },
  define: {
    'import.meta.vitest': mode !== 'production',
  },
}));
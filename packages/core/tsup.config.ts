import { defineConfig } from 'tsup'

export default defineConfig([
  // Universal APIs
  {
    entry: ['things/index.ts'],
    format: ['cjs', 'esm'],
    external: ['react', 'svelte', 'vue'],
    dts: true
  },
  // React APIs
  {
    entry: ['react/index.ts'],
    outDir: 'react/dist',
    banner: {
      js: "'use client'"
    },
    format: ['cjs', 'esm'],
    external: ['react', 'svelte', 'vue'],
    dts: true
  },
  // Svelte APIs
  {
    entry: ['svelte/index.ts'],
    outDir: 'svelte/dist',
    banner: {},
    format: ['cjs', 'esm'],
    external: ['react', 'svelte', 'vue'],
    dts: true,
    // `sswr` has some issue with `.es.js` that can't be resolved correctly by
    // vite so we have to bundle it here.
    noExternal: ['sswr']
  },
  // Vue APIs
  {
    entry: ['vue/index.ts'],
    outDir: 'vue/dist',
    banner: {},
    format: ['cjs', 'esm'],
    external: ['react', 'svelte', 'vue'],
    dts: true
  }
])

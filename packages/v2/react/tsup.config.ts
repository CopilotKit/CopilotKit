import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  // Avoid DTS generation during watch to prevent cross-package type resolution flakiness
  dts: !options.watch,
  sourcemap: true,
  clean: false, // Don't clean to preserve CSS file
  target: 'es2022',
  outDir: 'dist',
  external: ['react', 'react-dom'],
  esbuildOptions(opts) {
    // Resolve path aliases during build
    opts.alias = {
      '@': './src',
    };
  },
}));

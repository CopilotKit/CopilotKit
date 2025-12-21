import { defineConfig } from 'tsup';

const isWatch = process.argv.includes("--watch");

export default defineConfig({
  entry: ['src/index.ts', 'src/express.ts'],
  format: ['cjs', 'esm'],
  dts: isWatch ? false : true,
  sourcemap: true,
  clean: !isWatch,
  target: 'es2022',
  outDir: 'dist',
});

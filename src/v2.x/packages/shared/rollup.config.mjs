import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';

export default {
  input: 'src/index.ts',
  output: {
    file: 'dist/index.umd.js',
    format: 'umd',
    name: 'CopilotKitNextShared',
    sourcemap: true,
    inlineDynamicImports: true,
    globals: {
      'zod': 'Zod',
    },
  },
  external: ['zod'],
  plugins: [
    resolve({ browser: true }),
    commonjs(),
    json(),
    typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false }),
    terser(),
  ],
};

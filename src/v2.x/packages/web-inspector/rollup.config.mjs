import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';
import url from '@rollup/plugin-url';
import postcss from 'rollup-plugin-postcss';

export default {
  input: 'src/index.ts',
  output: {
    file: 'dist/index.umd.js',
    format: 'umd',
    name: 'CopilotKitNextWebInspector',
    sourcemap: true,
    inlineDynamicImports: true,
    globals: {
      'lit': 'Lit',
      'lit/decorators.js': 'LitDecorators',
    },
  },
  external: ['lit', 'lit/decorators.js'],
  plugins: [
    url({ include: ['**/*.svg', '**/*.png', '**/*.jpg', '**/*.gif'], limit: 0 }),
    postcss({ inject: true, minimize: true }),
    resolve({ browser: true }),
    commonjs(),
    json(),
    typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false }),
    terser(),
  ],
};

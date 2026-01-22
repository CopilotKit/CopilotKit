import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';
import url from '@rollup/plugin-url';
import postcss from 'rollup-plugin-postcss';

function onwarn(warning, warn) {
  // Ignore circular dependency warnings from node_modules
  if (warning.code === 'CIRCULAR_DEPENDENCY' && warning.ids?.some(id => id.includes('node_modules'))) return;
  // Ignore "this" rewritten to "undefined" warnings from node_modules
  if (warning.code === 'THIS_IS_UNDEFINED' && warning.id?.includes('node_modules')) return;
  warn(warning);
}

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
  onwarn,
  plugins: [
    url({ include: ['**/*.svg', '**/*.png', '**/*.jpg', '**/*.gif'], limit: 0 }),
    postcss({ inject: true, minimize: true }),
    resolve({ browser: true }),
    commonjs(),
    json(),
    typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false, compilerOptions: { target: 'ES2018', module: 'ESNext', moduleResolution: 'Bundler' } }),
    terser(),
  ],
};

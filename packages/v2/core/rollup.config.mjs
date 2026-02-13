import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';

function onwarn(warning, warn) {
  // Ignore circular dependency warnings from node_modules and internal source
  if (warning.code === 'CIRCULAR_DEPENDENCY') return;
  // Ignore "this" rewritten to "undefined" warnings from node_modules
  if (warning.code === 'THIS_IS_UNDEFINED' && warning.id?.includes('node_modules')) return;
  warn(warning);
}

export default {
  input: 'src/index.ts',
  output: {
    file: 'dist/index.umd.js',
    format: 'umd',
    name: 'CopilotKitNextCore',
    sourcemap: true,
    inlineDynamicImports: true,
    globals: {
      '@copilotkitnext/shared': 'CopilotKitNextShared',
      '@ag-ui/client': 'AgUIClient',
      '@ag-ui/core': 'AgUICore',
      'rxjs': 'rxjs',
      'zod': 'Zod',
    },
  },
  external: ['@copilotkitnext/shared', '@ag-ui/client', '@ag-ui/core', 'rxjs', 'zod'],
  onwarn,
  plugins: [
    resolve({ browser: true }),
    commonjs(),
    json(),
    typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false, compilerOptions: { target: 'ES2018', module: 'ESNext', moduleResolution: 'Bundler' } }),
    terser(),
  ],
};

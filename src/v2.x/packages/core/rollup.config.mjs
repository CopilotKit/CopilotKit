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
  plugins: [
    resolve({ browser: true }),
    commonjs(),
    json(),
    typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false }),
    terser(),
  ],
};

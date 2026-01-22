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
    name: 'CopilotKitShared',
    sourcemap: true,
    inlineDynamicImports: true,
    globals: {
      'zod': 'Zod',
      'graphql': 'GraphQL',
      'uuid': 'UUID',
      '@ag-ui/core': 'AgUICore',
    },
  },
  external: ['zod', 'graphql', 'uuid', '@ag-ui/core'],
  plugins: [
    resolve({ browser: true, preferBuiltins: false }),
    commonjs(),
    json(),
    typescript({
      tsconfig: './tsconfig.json',
      declaration: false,
      declarationMap: false,
      declarationDir: undefined,
      include: ['src/**/*.ts'],
      compilerOptions: {
        declaration: false,
        declarationMap: false,
        declarationDir: undefined,
      },
    }),
    terser(),
  ],
};

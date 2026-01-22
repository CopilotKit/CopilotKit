import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';

const commonPlugins = [
  resolve({ browser: true, preferBuiltins: false }),
  commonjs(),
  json(),
  typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false }),
  terser(),
];

const commonExternal = [
  '@copilotkitnext/shared',
  '@ag-ui/client',
  '@ag-ui/core',
  'rxjs',
  'zod',
  'hono',
  'express',
];

const commonGlobals = {
  '@copilotkitnext/shared': 'CopilotKitNextShared',
  '@ag-ui/client': 'AgUIClient',
  '@ag-ui/core': 'AgUICore',
  'rxjs': 'rxjs',
  'zod': 'Zod',
  'hono': 'Hono',
  'express': 'Express',
};

export default [
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.umd.js',
      format: 'umd',
      name: 'CopilotKitNextRuntime',
      sourcemap: true,
      inlineDynamicImports: true,
      globals: commonGlobals,
    },
    external: commonExternal,
    plugins: commonPlugins,
  },
  {
    input: 'src/express.ts',
    output: {
      file: 'dist/express.umd.js',
      format: 'umd',
      name: 'CopilotKitNextRuntimeExpress',
      sourcemap: true,
      inlineDynamicImports: true,
      globals: commonGlobals,
    },
    external: commonExternal,
    plugins: commonPlugins,
  },
];

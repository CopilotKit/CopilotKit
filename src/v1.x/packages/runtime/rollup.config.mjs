import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';

const commonPlugins = [
  resolve({ browser: true, preferBuiltins: false }),
  commonjs(),
  json(),
  typescript({
      tsconfig: './tsconfig.json',
      declaration: false,
      declarationMap: false,
      declarationDir: undefined,
      compilerOptions: {
        declaration: false,
        declarationMap: false,
        declarationDir: undefined,
      },
    }),
  terser(),
];

const commonExternal = [
  '@copilotkit/shared',
  '@copilotkitnext/agent',
  '@copilotkitnext/runtime',
  '@ag-ui/client',
  '@ag-ui/core',
  '@ag-ui/langgraph',
  'graphql',
  'graphql-yoga',
  'hono',
  'rxjs',
  'zod',
  'openai',
];

const commonGlobals = {
  '@copilotkit/shared': 'CopilotKitShared',
  '@copilotkitnext/agent': 'CopilotKitNextAgent',
  '@copilotkitnext/runtime': 'CopilotKitNextRuntime',
  '@ag-ui/client': 'AgUIClient',
  '@ag-ui/core': 'AgUICore',
  '@ag-ui/langgraph': 'AgUILangGraph',
  'graphql': 'GraphQL',
  'graphql-yoga': 'GraphQLYoga',
  'hono': 'Hono',
  'rxjs': 'rxjs',
  'zod': 'Zod',
  'openai': 'OpenAI',
};

export default [
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.umd.js',
      format: 'umd',
      name: 'CopilotKitRuntime',
      sourcemap: true,
      inlineDynamicImports: true,
      globals: commonGlobals,
    },
    external: commonExternal,
    plugins: commonPlugins,
  },
  {
    input: 'src/v2/index.ts',
    output: {
      file: 'dist/v2/index.umd.js',
      format: 'umd',
      name: 'CopilotKitRuntimeV2',
      sourcemap: true,
      inlineDynamicImports: true,
      globals: commonGlobals,
    },
    external: commonExternal,
    plugins: commonPlugins,
  },
  {
    input: 'src/langgraph.ts',
    output: {
      file: 'dist/langgraph.umd.js',
      format: 'umd',
      name: 'CopilotKitRuntimeLangGraph',
      sourcemap: true,
      inlineDynamicImports: true,
      globals: commonGlobals,
    },
    external: commonExternal,
    plugins: commonPlugins,
  },
];

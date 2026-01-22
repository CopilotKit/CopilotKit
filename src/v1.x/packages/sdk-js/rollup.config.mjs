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
  '@langchain/core',
  '@langchain/langgraph',
  'langchain',
  'zod',
];

const commonGlobals = {
  '@copilotkit/shared': 'CopilotKitShared',
  '@langchain/core': 'LangChainCore',
  '@langchain/langgraph': 'LangGraph',
  'langchain': 'LangChain',
  'zod': 'Zod',
};

export default [
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.umd.js',
      format: 'umd',
      name: 'CopilotKitSDK',
      sourcemap: true,
      inlineDynamicImports: true,
      globals: commonGlobals,
    },
    external: commonExternal,
    plugins: commonPlugins,
  },
  {
    input: 'src/langchain.ts',
    output: {
      file: 'dist/langchain.umd.js',
      format: 'umd',
      name: 'CopilotKitSDKLangChain',
      sourcemap: true,
      inlineDynamicImports: true,
      globals: commonGlobals,
    },
    external: commonExternal,
    plugins: commonPlugins,
  },
  {
    input: 'src/langgraph/index.ts',
    output: {
      file: 'dist/langgraph.umd.js',
      format: 'umd',
      name: 'CopilotKitSDKLangGraph',
      sourcemap: true,
      inlineDynamicImports: true,
      globals: commonGlobals,
    },
    external: commonExternal,
    plugins: commonPlugins,
  },
];

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
    name: 'CopilotKitRuntimeClientGQL',
    sourcemap: true,
    inlineDynamicImports: true,
    globals: {
      'react': 'React',
      '@copilotkit/runtime': 'CopilotKitRuntime',
      '@copilotkit/shared': 'CopilotKitShared',
      'urql': 'Urql',
      '@urql/core': 'UrqlCore',
      'graphql': 'GraphQL',
    },
  },
  external: [
    'react',
    '@copilotkit/runtime',
    '@copilotkit/shared',
    'urql',
    '@urql/core',
    'graphql',
  ],
  plugins: [
    resolve({ browser: true }),
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
  ],
};

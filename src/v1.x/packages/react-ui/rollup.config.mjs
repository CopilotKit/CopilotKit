import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';
import postcss from 'rollup-plugin-postcss';

export default {
  input: 'src/index.tsx',
  output: {
    file: 'dist/index.umd.js',
    format: 'umd',
    name: 'CopilotKitReactUI',
    sourcemap: true,
    inlineDynamicImports: true,
    globals: {
      'react': 'React',
      'react-dom': 'ReactDOM',
      '@copilotkit/react-core': 'CopilotKitReactCore',
      '@copilotkit/shared': 'CopilotKitShared',
      '@copilotkit/runtime-client-gql': 'CopilotKitRuntimeClientGQL',
    },
  },
  external: [
    'react',
    'react-dom',
    '@copilotkit/react-core',
    '@copilotkit/shared',
    '@copilotkit/runtime-client-gql',
  ],
  plugins: [
    postcss({ inject: true, minimize: true }),
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

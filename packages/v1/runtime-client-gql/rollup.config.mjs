import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';

function onwarn(warning, warn) {
  // Ignore circular dependency warnings from node_modules
  if (warning.code === 'CIRCULAR_DEPENDENCY' && warning.ids?.some(id => id.includes('node_modules'))) return;
  // Ignore "this" rewritten to "undefined" warnings from node_modules
  if (warning.code === 'THIS_IS_UNDEFINED' && warning.id?.includes('node_modules')) return;
  // Ignore TypeScript module/moduleResolution mismatch warning
  if (warning.code === 'PLUGIN_WARNING' && warning.message?.includes('TS5110')) return;
  warn(warning);
}

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
  onwarn,
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
        target: 'ES2017',
        module: 'ESNext',
      },
    }),
    terser(),
  ],
};

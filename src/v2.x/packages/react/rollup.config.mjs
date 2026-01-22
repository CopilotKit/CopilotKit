import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';
import postcss from 'rollup-plugin-postcss';

function onwarn(warning, warn) {
  // Ignore circular dependency warnings from node_modules
  if (warning.code === 'CIRCULAR_DEPENDENCY' && warning.ids?.some(id => id.includes('node_modules'))) return;
  // Ignore "this" rewritten to "undefined" warnings from node_modules
  if (warning.code === 'THIS_IS_UNDEFINED' && warning.id?.includes('node_modules')) return;
  // Ignore "use client" directive warnings (expected for React Server Components)
  if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message?.includes('"use client"')) return;
  warn(warning);
}

export default {
  input: 'src/index.ts',
  output: {
    file: 'dist/index.umd.js',
    format: 'umd',
    name: 'CopilotKitNextReact',
    sourcemap: true,
    inlineDynamicImports: true,
    globals: {
      'react': 'React',
      'react-dom': 'ReactDOM',
      '@copilotkitnext/core': 'CopilotKitNextCore',
      '@copilotkitnext/shared': 'CopilotKitNextShared',
      '@copilotkitnext/web-inspector': 'CopilotKitNextWebInspector',
      '@ag-ui/client': 'AgUIClient',
      '@ag-ui/core': 'AgUICore',
      'zod': 'Zod',
    },
  },
  external: [
    'react',
    'react-dom',
    '@copilotkitnext/core',
    '@copilotkitnext/shared',
    '@copilotkitnext/web-inspector',
    '@ag-ui/client',
    '@ag-ui/core',
    'zod',
  ],
  onwarn,
  plugins: [
    postcss({ inject: true, minimize: true }),
    resolve({ browser: true }),
    commonjs(),
    json(),
    typescript({
      tsconfig: './tsconfig.json',
      declaration: false,
      declarationMap: false,
      compilerOptions: { target: 'ES2018', module: 'ESNext', moduleResolution: 'Bundler' },
    }),
    terser(),
  ],
};

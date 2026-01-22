import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';
import postcss from 'rollup-plugin-postcss';

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
  plugins: [
    postcss({ inject: true, minimize: true }),
    resolve({ browser: true }),
    commonjs(),
    json(),
    typescript({
      tsconfig: './tsconfig.json',
      declaration: false,
      declarationMap: false,
    }),
    terser(),
  ],
};

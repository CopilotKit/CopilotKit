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
    name: 'CopilotKitA2UIRenderer',
    sourcemap: true,
    inlineDynamicImports: true,
    globals: {
      'react': 'React',
      'react-dom': 'ReactDOM',
      '@copilotkit/react-core': 'CopilotKitReactCore',
      '@copilotkitnext/react': 'CopilotKitNextReact',
      'lit': 'Lit',
      '@a2ui/lit': 'A2UILit',
      'zod': 'Zod',
    },
  },
  external: [
    'react',
    'react-dom',
    '@copilotkit/react-core',
    '@copilotkitnext/react',
    'lit',
    '@a2ui/lit',
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

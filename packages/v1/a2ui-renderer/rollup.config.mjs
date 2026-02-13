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
  // Ignore TypeScript plugin warnings (module mismatch, tslib, type errors during UMD build)
  if (warning.code === 'PLUGIN_WARNING' && warning.plugin === 'typescript') return;
  // Ignore "use client" directive warnings (expected for React Server Components)
  if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message?.includes('"use client"')) return;
  warn(warning);
}

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
      'react/jsx-runtime': 'React',
      'react-dom': 'ReactDOM',
      '@copilotkit/react-core': 'CopilotKitReactCore',
      '@copilotkit/react-core/v2': 'CopilotKitReactCore',
      '@copilotkitnext/react': 'CopilotKitNextReact',
      '@a2ui/lit': 'A2UILit',
      '@a2ui/lit/0.8': 'A2UILit',
      'zod': 'Zod',
    },
  },
  external: (id) => {
    // Match exact package names and all subpath imports (e.g., @a2ui/lit/0.8)
    const externalPkgs = [
      'react',
      'react-dom',
      '@copilotkit/react-core',
      '@copilotkitnext/react',
      '@a2ui/lit',
      'zod',
    ];
    return externalPkgs.some(pkg => id === pkg || id.startsWith(pkg + '/'));
  },
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

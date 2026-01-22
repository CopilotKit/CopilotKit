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
    name: 'CopilotKitNextAgent',
    sourcemap: true,
    inlineDynamicImports: true,
    globals: {
      '@ag-ui/client': 'AgUIClient',
      'ai': 'AI',
      'rxjs': 'rxjs',
      'zod': 'Zod',
      '@ai-sdk/openai': 'AISdkOpenAI',
      '@ai-sdk/anthropic': 'AISdkAnthropic',
      '@ai-sdk/google': 'AISdkGoogle',
      '@ai-sdk/mcp': 'AISdkMcp',
      '@modelcontextprotocol/sdk': 'McpSdk',
    },
  },
  external: [
    '@ag-ui/client',
    'ai',
    'rxjs',
    'zod',
    '@ai-sdk/openai',
    '@ai-sdk/anthropic',
    '@ai-sdk/google',
    '@ai-sdk/mcp',
    '@modelcontextprotocol/sdk',
  ],
  plugins: [
    resolve({ browser: true, preferBuiltins: false }),
    commonjs(),
    json(),
    typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false }),
    terser(),
  ],
};

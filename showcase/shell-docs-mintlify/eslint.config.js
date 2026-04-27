import eslintPluginAstro from 'eslint-plugin-astro';

export default [
  ...eslintPluginAstro.configs.recommended,
  {
    ignores: ['node_modules/', 'dist/', '.astro/'],
  },
];

import js from "@eslint/js";
import globals from "globals";
import pluginVue from "eslint-plugin-vue";
import tseslint from "typescript-eslint";
import vueParser from "vue-eslint-parser";

const sharedGlobals = {
  ...globals.browser,
  ...globals.node,
  defineNuxtConfig: "readonly",
};

export default [
  {
    ignores: [
      ".nuxt/**",
      ".output/**",
      "node_modules/**",
      "dist/**",
    ],
  },
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: sharedGlobals,
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/essential"],
  {
    files: ["**/*.{ts,mts,cts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
    },
  },
  {
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: "latest",
        sourceType: "module",
        extraFileExtensions: [".vue"],
      },
    },
  },
  {
    files: ["server/**/*.ts", "pages/**/*.vue", "nuxt.config.ts"],
    rules: {
      "no-undef": "off",
    },
  },
];

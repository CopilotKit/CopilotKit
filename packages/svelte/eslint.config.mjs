import js from "@eslint/js";
import tseslint from "typescript-eslint";
import sveltePlugin from "eslint-plugin-svelte";
import globals from "globals";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...sveltePlugin.configs["flat/recommended"],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".svelte"],
      },
    },
  },
  {
    ignores: ["dist/**", "node_modules/**"],
  },
);

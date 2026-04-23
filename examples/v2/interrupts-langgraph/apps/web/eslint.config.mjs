import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Flat-config ESLint setup for Next 16 / React 19 / TS 5. Mirrors the
// sibling `examples/showcases/open-mcp-client/apps/web/eslint.config.mjs`
// so lint behaviour stays consistent across starters. Next 16 removed
// the `next lint` command, so package.json now invokes `eslint .`
// directly against this config.
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;

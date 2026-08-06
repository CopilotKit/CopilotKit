import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      // The E2E LOCK_SKIN server's build dir (NEXT_DIST_DIR in
      // playwright.config.ts). Must be listed alongside `.next/**` — ESLint has
      // its own ignore list and does not read .gitignore, so without this a
      // single E2E run leaves generated output that `pnpm lint` then reports
      // tens of thousands of problems in.
      ".next-locked/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "playwright-report/**",
      "test-results/**",
    ],
  },
];

export default eslintConfig;

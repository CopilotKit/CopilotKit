import { defineConfig } from "vitest/config";

// Unit tests that live inside a showcase integration's own source tree.
//
// The integrations are deliberately outside the pnpm workspace, so the root
// vitest projects never pick them up and `nx run-many -t test` cannot see
// them. This config gives those tests one home to run from, driven by the
// monorepo's own vitest so no integration has to carry a test dependency into
// its Docker image. Run it with:
//
//   pnpm exec vitest run --config showcase/integrations/vitest.config.ts
// The include list is an allowlist, not a wildcard, and grows one integration
// at a time. Most integrations' existing `*.test.ts` files resolve imports
// through their own Next.js path aliases (`@/...`), which only exist under
// their own config, so sweeping them all in here would fail on arrival. Adding
// an integration to this list means first making its tests runnable from the
// repo root.
export default defineConfig({
  test: {
    root: __dirname,
    include: ["strands-typescript/src/agent/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/tests/e2e/**"],
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/unit/**/*.test.ts"],
    exclude: ["node_modules", "dist", "test/integration/**", "test/e2e/**"],
    environment: "node",
    globals: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // NOTE: we intentionally do NOT exclude `src/**/index.ts` wholesale.
      // Barrel-only re-export files are counted as covered-by-proxy (they
      // transitively execute when any consumer imports a symbol), so they
      // don't hurt the threshold. Excluding them wholesale would silently
      // drop an index.ts that gains real logic from the coverage surface.
      exclude: ["src/**/*.test.ts"],
      thresholds: {
        // Branches intentionally held AT lines/statements, not above:
        // the previous config set branches: 90 and the others to 85 —
        // inverted from the usual pattern (branches are hardest because
        // defensive guards for pb 5xx re-auth, S3 SDK dynamic import
        // failure, etc. are exercised integration-side, not unit-side).
        // A 90-branch floor caused spurious CI failures every time a
        // new guard landed without a paired unit test for its error arm.
        lines: 85,
        branches: 85,
        functions: 85,
        statements: 85,
      },
    },
  },
});

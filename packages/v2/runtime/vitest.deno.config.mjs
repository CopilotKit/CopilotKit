import { defineConfig } from "vitest/config";

/**
 * Vitest config specifically for Deno integration tests.
 * Deno must be installed — the tests spawn Deno as a subprocess.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/__tests__/integration/deno/**/*.{test,spec}.ts"],
    reporters: [["default", { summary: false }]],
    silent: true,
    testTimeout: 60_000,
  },
});

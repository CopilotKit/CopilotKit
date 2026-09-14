import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Removing filesystem/git fixtures can exceed 10s on busy CI runners.
    // Match the 30s budget used by the release integration tests.
    hookTimeout: 30_000,
    include: [
      "scripts/release/lib/**/*.{test,spec}.ts",
      "scripts/release/__tests__/**/*.{test,spec}.ts",
    ],
    reporters: [["default", { summary: false }]],
    silent: true,
  },
});

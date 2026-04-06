import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Prevent Scarf telemetry events from firing during test runs
    env: {
      COPILOTKIT_TELEMETRY_DISABLED: "true",
    },
    environment: "node",
    globals: true,
    include: ["src/**/__tests__/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/integration/bun/**"],
    reporters: [["default", { summary: false }]],
    silent: true,
    coverage: {
      reporter: ["text", "lcov", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/**/index.ts"],
    },
    setupFiles: [],
  },
});

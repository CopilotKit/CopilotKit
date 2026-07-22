import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: [
      "scripts/release/lib/**/*.{test,spec}.ts",
      "scripts/release/detect-intelligence-adapter-version-changes.test.ts",
    ],
    reporters: [["default", { summary: false }]],
    silent: true,
  },
});

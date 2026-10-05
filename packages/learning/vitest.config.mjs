import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "./src/__tests__/vitest-environment.mjs",
    include: ["src/**/__tests__/**/*.test.ts"],
    reporters: [["default", { summary: false }]],
  },
});

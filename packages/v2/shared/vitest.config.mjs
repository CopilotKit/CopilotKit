import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/__tests__/**/*.{test,spec}.ts"],
    reporters: [["default", { summary: false }]],
    silent: true,
  },
});

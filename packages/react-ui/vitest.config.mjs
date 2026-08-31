import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.{test,spec}.ts", "oxlint-rules/**/*.{test,spec}.mjs"],
    reporters: [["default", { summary: false }]],
    silent: true,
  },
});

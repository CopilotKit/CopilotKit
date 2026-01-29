import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
    reporters: [["default", { summary: false }]],
    silent: true,
  },
});

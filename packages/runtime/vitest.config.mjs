import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: [
      "src/**/*.{test,spec}.ts",
      "tests/**/*.{test,spec}.ts",
    ],
    exclude: ["**/dist/**"],
    setupFiles: ["./tests/setup.vitest.ts"],
    reporters: [["default", { summary: false }]],
    silent: true,
  },
});

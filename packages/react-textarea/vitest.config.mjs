import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    reporters: [["default", { summary: false }]],
    silent: true,
  },
});

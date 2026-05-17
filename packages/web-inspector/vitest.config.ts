import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    clearMocks: true,
    reporters: [["default", { summary: false }]],
    silent: true,
  },
});

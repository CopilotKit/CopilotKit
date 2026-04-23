import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environmentMatchGlobs: [
      ["src/webview/**", "jsdom"],
      ["src/extension/**", "node"],
    ],
  },
});

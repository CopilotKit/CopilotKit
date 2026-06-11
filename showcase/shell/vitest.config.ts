import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
    // Generates the gitignored registry.json (statically imported by
    // src/middleware.ts) before any worker transforms a test module —
    // see vitest.global-setup.ts.
    globalSetup: "./vitest.global-setup.ts",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

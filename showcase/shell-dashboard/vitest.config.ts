import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Default unit tests live under src/; the spike-replay integration
    // test for runtime env switching (B13) lives under tests/ because it
    // spawns `next build` + two `next start` invocations and is too heavy
    // for the per-file unit suite. The `.spike.test.ts` suffix scopes the
    // tests/-rooted include narrowly so visual snapshots stay out.
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.spike.test.ts"],
    exclude: ["tests/visual/**", "node_modules/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

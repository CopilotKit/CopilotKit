import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [svelte()],
  test: {
    environment: "jsdom",
    include: ["**/__tests__/**/*.test.ts"],
    globals: true,
    reporters: [["default", { summary: false }]],
  },
  resolve: {
    conditions: ["browser"],
    alias: {
      "@": resolve(__dirname, "./src"),
      "@copilotkit/web-inspector": resolve(
        __dirname,
        "./src/__tests__/mocks/web-inspector.ts",
      ),
    },
  },
});

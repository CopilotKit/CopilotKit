import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["**/__tests__/**/*.{test,spec}.{ts,tsx}"],
    globals: true,
    server: {
      deps: {
        inline: ["@a2ui/lit"],
      },
    },
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});

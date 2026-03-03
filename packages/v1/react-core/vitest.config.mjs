import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: [
      "src/**/__tests__/**/*.{test,spec}.{ts,tsx}",
      "src/**/*.{test,spec}.{ts,tsx}",
    ],
    setupFiles: ["./src/setupTests.ts"],
    reporters: [["default", { summary: false }]],
    silent: true,
    server: {
      deps: {
        inline: ["react-markdown", "streamdown", "@copilotkitnext"],
      },
    },
    css: {
      modules: {
        classNameStrategy: "non-scoped",
      },
    },
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});

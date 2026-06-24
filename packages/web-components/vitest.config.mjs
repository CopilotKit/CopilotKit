import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["**/__tests__/**/*.{test,spec}.ts"],
    passWithNoTests: true,
    globals: true,
    server: {
      deps: {
        inline: ["lit", "@lit/reactive-element", "lit-html", "lit-element"],
      },
    },
  },
});

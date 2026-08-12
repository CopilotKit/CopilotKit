import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["**/__tests__/**/*.{test,spec}.ts"],
    passWithNoTests: true,
    globals: true,
    server: {
      deps: {
        inline: ["lit", "@lit/reactive-element", "lit-element", "lit-html"],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.join(dirname, "src"),
    },
  },
});

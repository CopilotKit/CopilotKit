import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));
// From package dir to repo root (pnpm store lives at root node_modules/.pnpm)
const root = path.resolve(dirname, "../../../");

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["**/__tests__/**/*.{test,spec}.{ts,tsx}"],
    globals: true,
    server: {
      deps: {
        inline: ["@a2ui/lit", "clsx", "markdown-it", "zod"],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.join(dirname, "src"), 
  },
});

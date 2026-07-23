import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**"],
  },
  resolve: {
    alias: [
      // Match `@/anything` so transitive imports through registry.ts /
      // docs-render.tsx use the in-package src/ rather than tripping
      // vite's package resolver.
      {
        find: /^@\/(.*)$/,
        replacement: path.resolve(__dirname, "./src") + "/$1",
      },
    ],
  },
});

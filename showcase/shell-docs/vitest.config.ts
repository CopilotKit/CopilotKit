import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**"],
    // Many files load the whole docs content tree, so each worker can reach
    // 4-5 GB. Uncapped, Vitest starts one worker per core (17 on an 18-core
    // laptop) and the suite peaks near 35 GB, swapping the machine to a crawl.
    maxWorkers: 8,
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

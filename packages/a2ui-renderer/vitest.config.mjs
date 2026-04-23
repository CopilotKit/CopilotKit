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
    passWithNoTests: true,
    globals: true,
    server: {
      deps: {
        inline: ["@a2ui/lit", "clsx", "markdown-it", "zod"],
      },
    },
  },
  resolve: {
    alias: [
      { find: "@", replacement: path.join(dirname, "src") },
      { find: "clsx", replacement: path.join(dirname, "src/__tests__/clsx-shim.ts") },
      {
        find: "markdown-it",
        replacement: path.join(
          root,
          "node_modules/.pnpm/markdown-it@14.1.0/node_modules/markdown-it",
        ),
      },
      // React 17 does not declare a package "exports" field, so Node's ESM
      // resolver can't find bare subpath imports like `react/jsx-runtime` from
      // transpiled .mjs dependencies. Map to the explicit .js files; harmless
      // on 18/19 where the files also exist.
      { find: /^react\/jsx-runtime$/, replacement: "react/jsx-runtime.js" },
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: "react/jsx-dev-runtime.js",
      },
    ],
  },
});

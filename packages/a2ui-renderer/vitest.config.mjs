import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));
// From package dir to repo root (pnpm store lives at root node_modules/.pnpm)
const root = path.resolve(dirname, "../../../");

// React 17 has no package "exports" field, so Node's ESM resolver can't
// find bare subpaths like `react/jsx-runtime` when imported from a
// pre-built .mjs dependency. On 17 we map to the explicit .js files;
// on 18/19 we leave the exports field to do its job (the .js suffix is
// not in 18/19's exports map and would fail).
const localRequire = createRequire(import.meta.url);
let reactHasNoExportsField = false;
try {
  const reactPkgPath = localRequire.resolve("react/package.json");
  const reactPkg = JSON.parse(readFileSync(reactPkgPath, "utf8"));
  reactHasNoExportsField = !reactPkg.exports;
} catch {
  // ignore — fall through with default (no alias)
}

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
      {
        find: "clsx",
        replacement: path.join(dirname, "src/__tests__/clsx-shim.ts"),
      },
      {
        find: "markdown-it",
        replacement: path.join(
          root,
          "node_modules/.pnpm/markdown-it@14.1.0/node_modules/markdown-it",
        ),
      },
      ...(reactHasNoExportsField
        ? [
            {
              find: /^react\/jsx-runtime$/,
              replacement: "react/jsx-runtime.js",
            },
            {
              find: /^react\/jsx-dev-runtime$/,
              replacement: "react/jsx-dev-runtime.js",
            },
          ]
        : []),
    ],
  },
});

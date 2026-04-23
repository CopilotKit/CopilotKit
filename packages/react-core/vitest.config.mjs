import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

// React 17 has no package "exports" field, so Node's ESM resolver can't
// find bare subpaths like `react/jsx-runtime` when imported from a
// pre-built .mjs dependency (e.g. @radix-ui/react-slot). On 17 we map to
// the explicit .js files; on 18/19 we leave the exports field to do its
// job (the .js suffix is not in 18/19's exports map and would fail).
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
    globals: true,
    include: [
      "src/**/__tests__/**/*.{test,spec}.{ts,tsx}",
      "src/**/*.{test,spec}.{ts,tsx}",
    ],
    globalSetup: ["./src/v2/__tests__/globalSetup.ts"],
    setupFiles: ["./src/setupTests.ts", "./src/v2/__tests__/setup.ts"],
    reporters: [["default", { summary: false }]],
    silent: true,
    server: {
      deps: {
        inline: ["react-markdown", "streamdown", "@copilotkit"],
      },
    },
    css: {
      modules: {
        classNameStrategy: "non-scoped",
      },
    },
  },
  resolve: {
    alias: [
      { find: "@", replacement: new URL("./src/v2", import.meta.url).pathname },
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

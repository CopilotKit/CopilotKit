import { defineConfig } from "vitest/config";

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
      // React 17 does not declare a package "exports" field, so Node's ESM
      // resolver can't find bare subpath imports like `react/jsx-runtime` from
      // transpiled .mjs dependencies (e.g. @radix-ui/react-slot). Map to the
      // explicit .js files; harmless on 18/19 where the files also exist.
      { find: /^react\/jsx-runtime$/, replacement: "react/jsx-runtime.js" },
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: "react/jsx-dev-runtime.js",
      },
    ],
  },
});

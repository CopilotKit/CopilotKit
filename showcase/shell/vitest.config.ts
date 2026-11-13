import { configDefaults, defineConfig } from "vitest/config";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export default defineConfig({
  oxc: false,
  esbuild: {
    // Next preserves JSX, while Vitest must lower TSX before import analysis.
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    // Vitest's DEFAULT excludes (node_modules, dist, .git, ...) — the
    // previous hand-rolled ["node_modules/**"] silently REPLACED the
    // defaults instead of extending them (SU5-A5).
    exclude: [...configDefaults.exclude],
    // Generates the gitignored registry.json (statically imported by
    // src/middleware.ts) before any worker transforms a test module —
    // see vitest.global-setup.ts.
    globalSetup: "./vitest.global-setup.ts",
  },
  resolve: {
    alias: {
      // Shared frontend regression tests import cards from every standalone
      // integration. Resolve their UI dependencies here so those apps do not
      // each need an install, and all cards use the same React instance.
      ...Object.fromEntries(
        [
          "react",
          "react-dom",
          "lucide-react",
          "class-variance-authority",
          "clsx",
          "tailwind-merge",
        ].map((name) => [
          name,
          name === "react" || name === "react-dom"
            ? path.dirname(require.resolve(`${name}/package.json`))
            : require.resolve(name),
        ]),
      ),
      "@": path.resolve(__dirname, "./src"),
      // `server-only` (imported by src/lib/runtime-config.ts as a
      // client-bundle guard) THROWS under the plain-Node `default`
      // export condition vitest resolves with — point it at the
      // package's own empty `react-server` marker instead, exactly
      // what Next's server/middleware layers resolve. Located via
      // require.resolve (SU5-A5): a hard-coded ./node_modules path
      // breaks when the package manager hoists the package.
      "server-only": path.join(
        path.dirname(require.resolve("server-only")),
        "empty.js",
      ),
    },
  },
});

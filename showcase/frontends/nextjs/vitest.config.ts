import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig.json keeps JSX for Next (`jsx: preserve`); tests must compile it.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  resolve: {
    // The same paths as tsconfig.json.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@copilotkit/showcase-shared-tools": fileURLToPath(
        new URL("../../shared/typescript/tools", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
    // Playwright owns the e2e specs.
    exclude: [...configDefaults.exclude, "tests/e2e/**/*.spec.ts"],
  },
});

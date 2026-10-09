import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

export default defineConfig({
  // Mirrors the tsdown `define`; see src/v2/runtime/core/package-info.ts.
  define: {
    __COPILOTKIT_RUNTIME_VERSION__: JSON.stringify(version),
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.{test,spec}.ts", "tests/**/*.{test,spec}.ts"],
    exclude: ["**/dist/**", "**/integration/bun/**"],
    setupFiles: ["./tests/setup.vitest.ts"],
    reporters: [["default", { summary: false }]],
    silent: true,
  },
});

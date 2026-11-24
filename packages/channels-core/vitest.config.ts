import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

export default defineConfig({
  // Mirrors the tsdown `define`; see src/package-info.ts.
  define: {
    __CHANNELS_CORE_PACKAGE_VERSION__: JSON.stringify(version),
  },
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
  esbuild: { jsx: "automatic", jsxImportSource: "@copilotkit/channels-core" },
});

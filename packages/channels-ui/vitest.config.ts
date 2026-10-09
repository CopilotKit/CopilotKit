import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
  esbuild: { jsx: "automatic", jsxImportSource: "@copilotkit/channels-ui" },
  resolve: {
    alias: {
      "@copilotkit/channels-ui/jsx-runtime": fileURLToPath(
        new URL("./src/jsx-runtime.ts", import.meta.url),
      ),
      "@copilotkit/channels-ui/jsx-dev-runtime": fileURLToPath(
        new URL("./src/jsx-dev-runtime.ts", import.meta.url),
      ),
    },
  },
});

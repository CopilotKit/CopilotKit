import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
  esbuild: { jsx: "automatic", jsxImportSource: "@copilotkit/bot-ui" },
  resolve: {
    alias: {
      "@copilotkit/bot-ui/jsx-runtime": fileURLToPath(
        new URL("./src/jsx-runtime.ts", import.meta.url),
      ),
      "@copilotkit/bot-ui/jsx-dev-runtime": fileURLToPath(
        new URL("./src/jsx-dev-runtime.ts", import.meta.url),
      ),
    },
  },
});

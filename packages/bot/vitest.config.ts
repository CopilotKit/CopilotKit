import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
  esbuild: { jsx: "automatic", jsxImportSource: "@copilotkit/bot-ui" },
});

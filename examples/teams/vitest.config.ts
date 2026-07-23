import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "@copilotkit/channels",
  },
  test: {
    include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
  },
});

import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/v2/__tests__/setup.ts"],
    include: ["**/__tests__/**/*.test.ts"],
    globals: true,
    reporters: [["default", { summary: false }]],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@copilotkit/web-inspector": resolve(
        __dirname,
        "./src/v2/__tests__/mocks/web-inspector.ts",
      ),
    },
  },
});

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    root: path.resolve(__dirname),
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test-setup.ts"],
  },
});

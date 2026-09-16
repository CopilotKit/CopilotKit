import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/vitest/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Mirror the tsconfig path so tests resolve the shared-tools package the
      // same way the app does (it's a path alias, not a node_modules package).
      "@copilotkit/showcase-shared-tools": path.resolve(
        __dirname,
        "./shared-tools",
      ),
    },
  },
});

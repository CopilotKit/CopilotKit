import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // tsconfig uses `jsx: "preserve"` because Next.js owns the JSX transform.
  // Vitest has no Next.js pipeline, so tell esbuild to compile JSX itself.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
});

/// <reference types="vitest" />
import { defineConfig } from "vite";
import angular from "@analogjs/vite-plugin-angular";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const r = (...p: string[]) => resolve(__dirname, ...p);
// Analog imports `typescript` with no own dependency, so it would pick up the
// workspace TypeScript 7. TypeScript 7 has no JS API. Pin Analog to this
// package's TypeScript 5.9.3.
const typescriptRoot = dirname(
  createRequire(import.meta.url).resolve("typescript/package.json"),
);

export default defineConfig(({ mode }) => ({
  plugins: [angular()],
  resolve: {
    alias: {
      "@copilotkit/angular": r("src/public-api.ts"),
      typescript: typescriptRoot,
    },
    dedupe: [
      "@angular/core",
      "@angular/common",
      "@angular/platform-browser",
      "@angular/platform-browser-dynamic",
      "@angular/compiler",
      "@angular/core/testing",
    ],
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: [r("src/test-setup.ts")], // Use absolute path
    include: ["src/**/*.{spec,test}.{ts,tsx}"],
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
    reporters: [["default", { summary: false }]],
    silent: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "dist/",
        "*.config.*",
        "src/test-setup.ts",
        "src/index.ts",
        "src/public-api.ts",
      ],
    },
  },
  define: {
    "import.meta.vitest": mode !== "production",
  },
}));

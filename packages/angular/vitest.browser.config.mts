/// <reference types="vitest" />
/// <reference types="@vitest/browser/providers/playwright" />
import angular from "@analogjs/vite-plugin-angular";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const r = (...p: string[]) => resolve(__dirname, ...p);

export default defineConfig(({ mode }) => ({
  plugins: [angular()],
  optimizeDeps: {
    include: ["@angular/compiler", "@analogjs/vitest-angular/setup-testbed"],
  },
  resolve: {
    alias: {
      "@copilotkit/angular": r("src/public-api.ts"),
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
    setupFiles: [r("src/test-setup.browser.ts")],
    include: ["src/**/*.browser.spec.ts"],
    reporters: [["default", { summary: false }]],
    silent: true,
    browser: {
      enabled: true,
      headless: true,
      provider: "playwright",
      instances: [
        {
          browser: "chromium",
          launch: process.env.PLAYWRIGHT_EXECUTABLE_PATH
            ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
            : {},
        },
      ],
    },
  },
  define: {
    "import.meta.vitest": mode !== "production",
  },
}));

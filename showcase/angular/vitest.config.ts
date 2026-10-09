import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "scripts/**/*.test.ts",
      "src/app/cell-context.test.ts",
      "src/app/features/render-dynamic-component.test.ts",
    ],
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["channel/**/*.test.ts"] },
});

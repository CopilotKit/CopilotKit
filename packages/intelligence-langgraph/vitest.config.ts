import { defineConfig } from "vitest/config";
import { generateVersion } from "./scripts/generate-version.js";

await generateVersion();

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Resolve `include` against this directory, so the suite runs the same
    // from here or from the repo root (`--config showcase/integrations/...`).
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["*.test.ts"],
    environment: "node",
    globals: false,
  },
});

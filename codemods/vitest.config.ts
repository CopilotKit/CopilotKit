import { defineConfig } from "vitest/config";
import path from "node:path";

// Scoped to the codemods directory only so this config does not pick up
// any workspace-wide test setup. Run via `pnpm test:codemods` at the repo
// root or `pnpm exec vitest run --config codemods/vitest.config.ts` from
// anywhere in the repo.
export default defineConfig({
  test: {
    dir: path.resolve(__dirname),
    include: ["**/*.test.ts"],
    environment: "node",
    globals: true,
  },
});

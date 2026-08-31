import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // CVDIAG backend instrumentation unit tests (L1-E). The integration's
    // broader suite is Playwright e2e (`test:e2e`); this config scopes vitest
    // to the co-located cvdiag unit tests so they run without the Next.js
    // build toolchain.
    include: [
      "src/cvdiag-backend.test.ts",
      "src/cvdiag-backend-persist.e2e.test.ts",
      // TanStack→AG-UI converter state emission (`/delegations`, `/steps`).
      // Pure event-in/event-out, so it needs no Next.js build either.
      "src/lib/factory/tanstack-factory.test.ts",
      // Shared agent-loop budget + RUN_ERROR fail-loud guard, and the two
      // real-LLM defects they fix (see demo-stream.ts). Pure functions.
      "src/lib/factory/demo-stream.test.ts",
      // json_object's "input must mention json" precondition + the converter's
      // RUN_ERROR handling. Mocks the adapter, so no network and no Next build.
      "src/lib/factory/byoc-json-render-factory.test.ts",
      // gen-ui-agent progress card: headline must follow the step data, not the
      // run lifecycle. Static render only.
      "src/app/demos/gen-ui-agent/InlineAgentStateCard.test.ts",
    ],
    // The live-PB e2e seam needs room to boot PocketBase + drain flush windows.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

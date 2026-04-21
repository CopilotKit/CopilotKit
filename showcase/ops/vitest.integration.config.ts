import { defineConfig } from "vitest/config";

// Integration tests share a single PocketBase instance (collection schema,
// status rows, alert_state rows) and cannot tolerate parallel writes
// racing across workers. Force a single forked process so all suites run
// in-order against the same shared fixture. `forks` (not `threads`)
// because some test helpers set env vars + require() singletons, and
// thread pool sharing would cross-contaminate those.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 30_000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});

import { describe } from "vitest";
import { runStateStoreConformance } from "@copilotkit/bot";
import { createPostgresStore } from "./postgres-store.js";

const url = process.env.TEST_POSTGRES_URL;

// All PostgresStore instances share the same tables, and the conformance suite
// reuses fixed keys ("a", "k", "L", "q", …) across tests. A unique keyPrefix per
// make() namespaces those keys so repeated keys never collide across tests. The
// pool is closed on teardown. Without TEST_POSTGRES_URL the suite skips so unit
// runs stay hermetic.
(url ? describe : describe.skip)("PostgresStore", () => {
  runStateStoreConformance(
    "PostgresStore",
    async () =>
      createPostgresStore({
        connectionString: url,
        autoMigrate: true,
        keyPrefix: `t:${Math.random().toString(36).slice(2)}:`,
      }),
    async (s) => {
      await (s as { end?: () => Promise<void> }).end?.();
    },
  );
});

import { describe } from "vitest";
import { runStateStoreConformance } from "@copilotkit/bot";
import { createRedisStore } from "./redis-store.js";

const url = process.env.TEST_REDIS_URL;

// Each run uses a unique prefix so concurrent/repeat runs don't collide; the
// store is closed on teardown. Without TEST_REDIS_URL the suite skips so unit
// runs stay hermetic.
(url ? describe : describe.skip)("RedisStore", () => {
  runStateStoreConformance(
    "RedisStore",
    async () =>
      createRedisStore({
        url,
        keyPrefix: `t:${Math.random().toString(36).slice(2)}:`,
      }),
    async (s) => {
      await (s as { quit?: () => Promise<void> }).quit?.();
    },
  );
});

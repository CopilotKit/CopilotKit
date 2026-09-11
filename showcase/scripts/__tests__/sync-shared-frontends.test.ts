import { syncSharedFrontends } from "../sync-shared-frontends";

import { expect, test } from "vitest";

test("shared React demo sources are materialized without per-integration drift", () => {
  expect(syncSharedFrontends()).toEqual([]);
});

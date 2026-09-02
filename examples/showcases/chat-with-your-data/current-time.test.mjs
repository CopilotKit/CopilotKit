import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { startCurrentTimeUpdates } from "./lib/current-time.mjs";

test("refreshes the current time until the subscriber stops", () => {
  mock.timers.enable({ apis: ["setInterval"] });

  try {
    let updateCount = 0;
    const stopUpdates = startCurrentTimeUpdates(() => {
      updateCount += 1;
    });

    mock.timers.tick(999);
    assert.equal(updateCount, 0);

    mock.timers.tick(1);
    assert.equal(updateCount, 1);

    stopUpdates();
    mock.timers.tick(1_000);
    assert.equal(updateCount, 1);
  } finally {
    mock.timers.reset();
  }
});

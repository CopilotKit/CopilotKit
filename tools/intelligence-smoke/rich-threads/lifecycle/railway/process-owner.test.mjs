import test from "node:test";
import assert from "node:assert/strict";
import { processOwner, ownerAlive } from "./process-owner.mjs";
test("live owner is verified and reused Linux PID identity is rejected", async () => {
  const owner = await processOwner();
  assert.equal(await ownerAlive(owner), true);
  if (process.platform === "linux")
    assert.equal(
      await ownerAlive({ ...owner, startTicks: "different" }),
      false,
    );
  assert.equal(await ownerAlive({ pid: 2147483647 }), false);
});

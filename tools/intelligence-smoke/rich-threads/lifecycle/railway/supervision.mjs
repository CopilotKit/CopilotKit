import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
export async function verifySupervisor(config) {
  const receipt = JSON.parse(
    await readFile(
      join(config.controlDirectory, "supervisor-lock", "owner.json"),
      "utf8",
    ),
  );
  assert.equal(
    receipt.token,
    process.env.RICH_RAILWAY_SUPERVISOR_TOKEN,
    "Start the worker through the durable Railway supervisor",
  );
  assert.equal(
    receipt.pid,
    process.ppid,
    "Supervisor must own the worker process",
  );
  assert.ok(
    Date.now() < Date.parse(receipt.workerDeadline),
    "Supervisor lifetime expired",
  );
  process.kill(receipt.pid, 0);
  return receipt;
}

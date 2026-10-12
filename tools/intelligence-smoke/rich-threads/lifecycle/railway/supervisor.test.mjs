import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { supervise } from "./supervisor.mjs";
import { verifySupervisor } from "./supervision.mjs";
async function control(t) {
  const controlDirectory = await mkdtemp(join(tmpdir(), "railway-supervisor-"));
  t.after(() => rm(controlDirectory, { recursive: true, force: true }));
  return { controlDirectory };
}
test("worker requires its actual parent supervisor and inherited capability", async (t) => {
  const config = await control(t);
  await assert.rejects(verifySupervisor(config));
  const moduleUrl = new URL("./supervision.mjs", import.meta.url).href;
  const source = `import {verifySupervisor} from ${JSON.stringify(moduleUrl)};await verifySupervisor(${JSON.stringify(config)});`;
  await supervise({
    config,
    command: [process.execPath, "--input-type=module", "-e", source],
  });
  await assert.rejects(
    readFile(join(config.controlDirectory, "supervisor-lock/owner.json")),
    { code: "ENOENT" },
  );
});
test("worker failure invokes retained ownership recovery before rejecting run", async (t) => {
  const config = await control(t);
  let recovered;
  const source = `const fs=require('fs');const path=require('path');const root=${JSON.stringify(config.controlDirectory)};fs.mkdirSync(path.join(root,'active-run'));fs.writeFileSync(path.join(root,'active-run/lease.json'),JSON.stringify({runId:'crashed',pid:process.pid}));process.exit(3);`;
  await assert.rejects(
    supervise(
      { config, command: [process.execPath, "-e", source] },
      {
        recover: async ({ runId }) => {
          recovered = runId;
          await rm(join(config.controlDirectory, "active-run"), {
            recursive: true,
          });
        },
      },
    ),
    /worker failed/,
  );
  assert.equal(recovered, "crashed");
});
test("existing supervisor lock rejects a second worker", async (t) => {
  const config = await control(t);
  await mkdir(join(config.controlDirectory, "supervisor-lock"));
  await assert.rejects(
    supervise({ config, command: [process.execPath, "-e", "process.exit(0)"] }),
    { code: "EEXIST" },
  );
});
test("cancellation during previous recovery cannot start another worker", async (t) => {
  const config = await control(t);
  await mkdir(join(config.controlDirectory, "active-run"));
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    join(config.controlDirectory, "active-run/lease.json"),
    JSON.stringify({ runId: "previous" }),
  );
  const marker = join(config.controlDirectory, "worker-started");
  await assert.rejects(
    supervise(
      {
        config,
        command: [
          process.execPath,
          "-e",
          `require('fs').writeFileSync(${JSON.stringify(marker)},'started')`,
        ],
      },
      {
        recover: async () => {
          process.emit("SIGTERM");
          await rm(join(config.controlDirectory, "active-run"), {
            recursive: true,
          });
        },
      },
    ),
    /cancelled during recovery/,
  );
  await assert.rejects(readFile(marker), { code: "ENOENT" });
});
test("dead recovery lock can be reacquired while live ownership cannot", async (t) => {
  const config = await control(t);
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const { durableJson, recoveryLock } = await import("./journal.mjs");
  const path = join(config.controlDirectory, "recovery-lock");
  const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
  const deadPid = child.pid;
  await once(child, "exit");
  await mkdir(path);
  await durableJson(join(path, "owner.json"), {
    pid: deadPid,
    token: "11111111-1111-4111-8111-111111111111",
  });
  const release = await recoveryLock(path);
  await assert.rejects(recoveryLock(path), /still alive/);
  await release();
});

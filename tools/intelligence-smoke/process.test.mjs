import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandRunner } from "./process.mjs";

test("failed and timed-out setup commands fail while preserving redacted logs", async () => {
  const output = await mkdtemp(join(tmpdir(), "smoke-process-"));
  try {
    const run = commandRunner(output, ["private-token"]);
    assert.equal(
      await run(
        process.execPath,
        ["-e", "process.stdout.write('nested-private-config')"],
        { step: "private", sensitive: true },
      ),
      "nested-private-config",
    );
    assert.equal(
      (await readFile(join(output, "private.log"), "utf8")).includes(
        "nested-private-config",
      ),
      false,
    );
    await assert.rejects(
      run(
        process.execPath,
        ["-e", "console.error('private-token'); process.exit(7)"],
        { step: "failed" },
      ),
      /failed.*7/,
    );
    assert.equal(
      (await readFile(join(output, "failed.log"), "utf8")).includes(
        "private-token",
      ),
      false,
    );
    await assert.rejects(
      run(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {
        step: "timeout",
        timeoutMs: 20,
      }),
      /timeout/,
    );
    const started = Date.now();
    await assert.rejects(
      run(
        process.execPath,
        [
          "-e",
          "require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 1500)'], {stdio:'inherit'}); setInterval(()=>{}, 1000)",
        ],
        { step: "descendant", timeoutMs: 100 },
      ),
      /timeout/,
    );
    assert.ok(
      Date.now() - started < 1000,
      "A grandchild must not retain output pipes past the deadline",
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

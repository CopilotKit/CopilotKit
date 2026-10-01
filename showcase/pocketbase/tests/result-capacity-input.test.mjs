import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("custom fixture input fails before Docker or temporary resource allocation", () => {
  const root = mkdtempSync(join(tmpdir(), "pb-capacity-input-"));
  try {
    const capture = join(root, "capture.json");
    const commands = join(root, "docker-calls");
    writeFileSync(capture, JSON.stringify({ padding: "<".repeat(400000) }));
    writeFileSync(commands, "");
    // A command boundary sentinel: no database behavior is simulated.
    writeFileSync(
      join(root, "docker"),
      `#!${process.execPath}
require("node:fs").appendFileSync(${JSON.stringify(commands)}, "called\\n");
process.exit(1);
`,
      { mode: 0o700 },
    );
    const driver = fileURLToPath(
      new URL("./result-capacity.integration.mjs", import.meta.url),
    );
    for (const input of [capture, ""]) {
      const run = spawnSync(process.execPath, [driver], {
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          PATH: root + delimiter + process.env.PATH,
          // The empty-value case also proves rejection precedes mkdtemp.
          TMPDIR: input ? root : join(root, "must-not-be-created"),
          PB_TEST_BASELINE_IMAGE: "unsupported-input-must-not-use-an-image",
          PB_TEST_RESULT_FILE: input,
        },
      });
      assert.equal(run.error, undefined);
      assert.notEqual(run.status, 0);
      assert.match(
        run.stdout + run.stderr,
        /PB_TEST_RESULT_FILE is unsupported; use the deterministic 42-cell regression fixture/,
      );
      assert.equal(readFileSync(commands, "utf8"), "", "Docker was invoked");
      assert.deepEqual(readdirSync(root).sort(), [
        "capture.json",
        "docker",
        "docker-calls",
      ]);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

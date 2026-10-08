import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
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

for (const signal of ["SIGINT", "SIGTERM"]) {
  for (const phase of ["command", "between", "cleanup"]) {
    test(
      `${signal} during ${phase} preserves cleanup and leaves no descendants`,
      {
        skip: process.platform === "win32",
        timeout: 10_000,
      },
      async () => {
        const output = await mkdtemp(join(tmpdir(), "smoke-signal-"));
        let runner;
        const pids = [];
        try {
          const tree = join(output, "tree.cjs");
          await writeFile(
            tree,
            `
          const { spawn } = require('node:child_process');
          const { writeFileSync } = require('node:fs');
          const grandchild = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 1000)'], { stdio: 'inherit' });
          writeFileSync(${JSON.stringify(join(output, "pids.json"))}, JSON.stringify([process.pid, grandchild.pid]));
          setInterval(()=>{}, 1000);
        `,
          );
          const fixture = join(output, "runner.mjs");
          await writeFile(
            fixture,
            `
          import { commandRunner } from ${JSON.stringify(new URL("./process.mjs", import.meta.url).href)};
          import { writeFile } from 'node:fs/promises';
          const run = commandRunner(${JSON.stringify(output)}, [], { handleSignals: true });
          let failure;
          try {
            if (${JSON.stringify(phase)} === 'command') {
              console.log('ready');
              await run(process.execPath, [${JSON.stringify(tree)}], { step: 'active' });
            } else {
              if (${JSON.stringify(phase)} === 'cleanup') run.beginCleanup();
              console.log('ready');
              const keepAlive = setInterval(() => {}, 1000);
              await new Promise(resolve => process.once(${JSON.stringify(signal)}, resolve));
              clearInterval(keepAlive);
            }
            if (${JSON.stringify(phase)} !== 'cleanup') {
              await run(process.execPath, ['-e', 'console.log("unexpected")'], { step: 'forbidden' });
            }
          } catch (error) {
            failure = String(error);
            await run(process.execPath, ['-e', 'console.log("inner-cleanup")'], { step: 'inner-cleanup', cleanup: true });
            try {
              await run(process.execPath, ['-e', 'console.log("unexpected")'], { step: 'forbidden' });
              throw new Error('Cancellation was cleared by inner cleanup');
            } catch (next) {
              if (!String(next).includes('interrupted')) throw next;
            }
          }
          finally {
            run.beginCleanup();
            await run(process.execPath, ['-e', ${JSON.stringify('require("node:fs").writeFileSync(' + JSON.stringify(join(output, "cleanup-ready")) + ', "ready"); setTimeout(()=>{}, 250)')}], { step: 'cleanup', timeoutMs: 1000 });
            await writeFile(${JSON.stringify(join(output, "result.json"))}, JSON.stringify({ failure, signal: run.interruption?.signal }));
            process.exitCode = run.interruption?.exitCode ?? (failure ? 1 : 0);
            run.dispose();
          }
        `,
          );
          runner = spawn(process.execPath, [fixture], {
            stdio: ["ignore", "pipe", "pipe"],
          });
          const closed = once(runner, "close");
          let stdout = "";
          runner.stdout.on("data", (chunk) => {
            stdout += chunk;
          });
          const waitFor = async (predicate) => {
            const deadline = Date.now() + 3000;
            while (!(await predicate())) {
              assert.ok(
                Date.now() < deadline,
                "fixture did not reach expected phase",
              );
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
          };
          await waitFor(() => stdout.includes("ready"));
          if (phase === "command") {
            await waitFor(async () => {
              try {
                pids.push(
                  ...JSON.parse(
                    await readFile(join(output, "pids.json"), "utf8"),
                  ),
                );
                return true;
              } catch {
                return false;
              }
            });
          }
          runner.kill(signal);
          // A second interrupt must not abort the cleanup command.
          await waitFor(async () => {
            try {
              return (
                (await readFile(join(output, "cleanup-ready"), "utf8")) ===
                "ready"
              );
            } catch {
              return false;
            }
          });
          runner.kill(signal);
          const [code, exitSignal] = await closed;
          assert.equal(exitSignal, null);
          assert.equal(code, signal === "SIGINT" ? 130 : 143);
          const result = JSON.parse(
            await readFile(join(output, "result.json"), "utf8"),
          );
          assert.equal(result.signal, signal);
          if (phase !== "cleanup") assert.match(result.failure, /interrupted/);
          await assert.rejects(readFile(join(output, "forbidden.log")), {
            code: "ENOENT",
          });
          for (const pid of pids) {
            await waitFor(() => {
              try {
                process.kill(pid, 0);
                return false;
              } catch (error) {
                return error.code === "ESRCH";
              }
            });
          }
        } finally {
          if (runner && runner.exitCode === null && runner.signalCode === null)
            runner.kill("SIGKILL");
          for (const pid of pids) {
            try {
              process.kill(pid, "SIGKILL");
            } catch {}
          }
          await rm(output, { recursive: true, force: true });
        }
      },
    );
  }
}

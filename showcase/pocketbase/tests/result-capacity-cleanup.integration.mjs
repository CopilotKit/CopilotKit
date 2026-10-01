import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
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

const image = process.env.PB_TEST_BASELINE_IMAGE;
assert.ok(image, "PB_TEST_BASELINE_IMAGE must be an official baseline image");
const dockerPath = execFileSync("which", ["docker"], {
  encoding: "utf8",
}).trim();
const contextArgs = process.env.PB_TEST_DOCKER_CONTEXT
  ? ["--context", process.env.PB_TEST_DOCKER_CONTEXT]
  : [];
const docker = (...args) =>
  spawnSync(dockerPath, [...contextArgs, ...args], { encoding: "utf8" });
const driver = fileURLToPath(
  new URL("./result-capacity.integration.mjs", import.meta.url),
);

// Only the failure boundary is injected. Allocation, startup, inspection, and
// cleanup use the real Docker daemon and the unchanged capacity proof driver.
function scenario(fault, keep = false) {
  const root = mkdtempSync(join(tmpdir(), "pb-capacity-cleanup-"));
  const evidence = join(root, "evidence");
  const temporary = join(root, "temporary");
  const commands = join(root, "commands.jsonl");
  const blocker = `pb-capacity-fault-${randomUUID().slice(0, 8)}`;
  let ownsBlocker = false;
  let resources = { containers: [], volumes: [] };
  const failures = [];
  mkdirSync(evidence);
  mkdirSync(temporary);
  writeFileSync(commands, "");
  // Existing receipts remain writable; only creation of new server logs fails.
  writeFileSync(join(evidence, "baseline-red.json"), "");
  if (fault === "evidence") chmodSync(evidence, 0o500);
  try {
    let port = "";
    if (fault === "port") {
      ownsBlocker = true;
      const started = docker(
        "run",
        "-d",
        "--name",
        blocker,
        "-p",
        "127.0.0.1::8090",
        image,
      );
      assert.equal(started.status, 0, started.stderr);
      const inspected = docker("inspect", blocker);
      assert.equal(inspected.status, 0, inspected.stderr);
      port = JSON.parse(inspected.stdout)[0].NetworkSettings.Ports[
        "8090/tcp"
      ][0].HostPort;
    }
    const wrapper = join(root, "docker");
    writeFileSync(
      wrapper,
      `#!${process.execPath}
const { appendFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
appendFileSync(process.env.CLEANUP_COMMANDS, JSON.stringify(args) + "\\n");
const command = args[0] === "--context" ? args[2] : args[0];
if (process.env.CLEANUP_FAULT === "port" && command === "run") {
  args[args.indexOf("-p") + 1] = "127.0.0.1:" + process.env.CLEANUP_PORT + ":8090";
}
if (process.env.CLEANUP_FAULT === "absent" && command === "run") {
  args[args.length - 1] = "pb-capacity-absent:never-created-" + process.env.CLEANUP_NONCE;
  args.splice(args.indexOf("run") + 1, 0, "--pull=never");
}
if ((process.env.CLEANUP_FAULT === "logs" && command === "logs") ||
    process.env.CLEANUP_FAULT === "remove" && command === "rm" ||
    process.env.CLEANUP_FAULT === "stop" && command === "stop") {
  console.error("injected " + command + " failure");
  process.exit(1);
}
const result = spawnSync(process.env.CLEANUP_DOCKER, args, { stdio: "inherit" });
if (process.env.CLEANUP_FAULT === "volume" && command === "volume" &&
    args.includes("create") && result.status === 0) {
  console.error("injected volume allocation receipt failure");
  process.exit(1);
}
process.exit(result.status ?? 1);
`,
      { mode: 0o700 },
    );
    const run = spawnSync(process.execPath, [driver], {
      encoding: "utf8",
      timeout: 120000,
      env: {
        ...process.env,
        PATH: root + delimiter + process.env.PATH,
        TMPDIR: temporary,
        PB_TEST_MODE: "legacy",
        PB_TEST_EVIDENCE_DIR: evidence,
        PB_TEST_KEEP_ARTIFACTS: keep ? "1" : "0",
        CLEANUP_COMMANDS: commands,
        CLEANUP_DOCKER: dockerPath,
        CLEANUP_FAULT: fault,
        CLEANUP_PORT: port,
        CLEANUP_NONCE: randomUUID(),
      },
    });
    const calls = readFileSync(commands, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .map((args) => (args[0] === "--context" ? args.slice(2) : args));
    resources = {
      containers: calls
        .filter((args) => args[0] === "run")
        .map((args) => args[args.indexOf("--name") + 1]),
      volumes: calls
        .filter((args) => args[0] === "volume" && args[1] === "create")
        .map((args) => args[2]),
    };
    if (fault !== "volume")
      assert.ok(
        resources.containers.length > 0,
        "Fault must reach real allocation",
      );
    assert.ok(
      resources.volumes.length > 0,
      "Fault must allocate a private volume",
    );
    assert.equal(run.error, undefined);
    assert.notEqual(run.status, 0, "Fault run must fail visibly");
    const output = run.stdout + run.stderr;
    const resourceState = {
      containers: resources.containers.map((name) => ({
        name,
        state: docker(
          "inspect",
          "--format",
          "{{.State.Status}}",
          name,
        ).stdout.trim(),
      })),
      volumes: resources.volumes.map((name) => ({
        name,
        exists: docker("volume", "inspect", name).status === 0,
      })),
      temporary: readdirSync(temporary),
    };
    console.log(
      JSON.stringify({
        fault,
        keep,
        resources,
        resourceState,
        status: run.status,
      }),
    );
    console.log(output);
    if (fault === "port") {
      assert.match(output, /port is already allocated|address already in use/i);
    } else if (fault === "absent") {
      assert.match(output, /No such image/i);
      assert.doesNotMatch(
        output,
        /resource finalization failed/,
        "A container never created must not add a cleanup error",
      );
    } else if (fault === "volume") {
      assert.match(output, /injected volume allocation receipt failure/);
    } else {
      assert.match(
        output,
        /Complete result over 64 KiB must persist/,
        "Original test failure must remain visible",
      );
      assert.match(output, /validation_json_size_limit/);
    }
    if (fault === "evidence") assert.match(output, /EACCES/);
    if (["logs", "remove", "stop"].includes(fault)) {
      assert.match(
        output,
        new RegExp(`injected ${fault === "remove" ? "rm" : fault} failure`),
      );
    }
    if (fault === "remove") {
      assert.ok(
        calls.some((args) => args[0] === "volume" && args[1] === "rm"),
        "Container removal failure must not skip volume cleanup",
      );
      assert.match(
        output,
        /volume is in use/i,
        "Volume cleanup error must also remain visible",
      );
    } else {
      for (const name of resources.containers) {
        const inspected = docker("inspect", name);
        if (keep && fault !== "stop") {
          assert.equal(inspected.status, 0, inspected.stderr);
          assert.equal(JSON.parse(inspected.stdout)[0].State.Running, false);
        } else {
          assert.notEqual(
            inspected.status,
            0,
            `Leaked container ${name}: ${inspected.stdout}`,
          );
        }
      }
      for (const name of resources.volumes) {
        const inspected = docker("volume", "inspect", name);
        assert.equal(
          inspected.status === 0,
          keep,
          `Unexpected volume retention: ${name}`,
        );
      }
    }
    assert.deepEqual(
      readdirSync(temporary),
      [],
      "Temporary migration directory leaked",
    );
  } catch (error) {
    failures.push(error);
  } finally {
    // The regression runner owns only names issued by this private driver run.
    // Clean up even on RED so no reproduction leaves a daemon resource behind.
    if (existsSync(commands)) {
      const calls = readFileSync(commands, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .map((args) => (args[0] === "--context" ? args.slice(2) : args));
      for (const call of calls.filter((args) => args[0] === "run")) {
        const removed = docker(
          "rm",
          "-f",
          "-v",
          call[call.indexOf("--name") + 1],
        );
        if (removed.status !== 0 && !/No such container:/i.test(removed.stderr))
          failures.push(
            new Error(`Regression container cleanup failed: ${removed.stderr}`),
          );
      }
      for (const call of calls.filter(
        (args) => args[0] === "volume" && args[1] === "create",
      )) {
        const removed = docker("volume", "rm", call[2]);
        if (removed.status !== 0 && !/no such volume/i.test(removed.stderr))
          failures.push(
            new Error(`Regression volume cleanup failed: ${removed.stderr}`),
          );
      }
    }
    if (ownsBlocker) {
      const removed = docker("rm", "-f", "-v", blocker);
      if (removed.status !== 0 && !/No such container:/i.test(removed.stderr))
        failures.push(
          new Error(`Regression blocker cleanup failed: ${removed.stderr}`),
        );
    }
    try {
      chmodSync(evidence, 0o700);
      rmSync(root, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      "Resource regression and finalization failed",
    );
}

test("unwritable evidence preserves the assertion and removes private resources", () =>
  scenario("evidence"));
test("log retrieval failure preserves the assertion and removes private resources", () =>
  scenario("logs"));
test("real Docker startup failure removes the created container and volume", () =>
  scenario("port"));
test("container cleanup failure does not skip volume or temporary cleanup", () =>
  scenario("remove"));
test("preservation stops retained resources despite failed evidence collection", () =>
  scenario("evidence", true));
test("preservation falls back to removal when stopping a running container fails", () =>
  scenario("stop", true));
test("Docker failure before container creation still removes its private volume", () =>
  scenario("absent"));
test("volume allocation receipt failure still removes the allocated private volume", () =>
  scenario("volume"));

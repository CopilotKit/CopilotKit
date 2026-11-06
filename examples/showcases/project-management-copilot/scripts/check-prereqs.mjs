#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const PREREQS = {
  install: [
    {
      command: "uv",
      label: "uv",
      url: "https://docs.astral.sh/uv/getting-started/installation/",
      reason:
        "Required to install the Python agent's dependencies via `uv sync`.",
    },
  ],
  dev: [
    {
      command: "uv",
      label: "uv",
      url: "https://docs.astral.sh/uv/getting-started/installation/",
      reason: "Required to run the LangGraph Python agent.",
    },
    {
      command: "docker",
      label: "Docker",
      url: "https://docs.docker.com/get-started/get-docker/",
      reason:
        "Required to start the Postgres, Redis, and Intelligence services.",
      check: (cmd) => {
        if (!hasCommand(cmd)) return "missing";
        const probe = spawnSync(cmd, ["info"], { stdio: "ignore" });
        return probe.status === 0 ? "ok" : "not-running";
      },
    },
  ],
};

function hasCommand(cmd) {
  const probe = spawnSync(
    process.platform === "win32" ? "where" : "which",
    [cmd],
    { stdio: "ignore" },
  );
  return probe.status === 0;
}

const phase = process.argv[2];
const list = PREREQS[phase];
if (!list) {
  console.error(`check-prereqs: unknown phase "${phase}"`);
  process.exit(2);
}

const failures = [];
for (const prereq of list) {
  const status = prereq.check
    ? prereq.check(prereq.command)
    : hasCommand(prereq.command)
      ? "ok"
      : "missing";
  if (status !== "ok") failures.push({ ...prereq, status });
}

if (failures.length === 0) process.exit(0);

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

console.error("");
console.error(red(bold("✖ Missing prerequisites for this template")));
console.error("");
for (const f of failures) {
  const headline =
    f.status === "not-running"
      ? `${f.label} is installed but does not appear to be running.`
      : `${f.label} is not installed.`;
  console.error(`  • ${bold(headline)}`);
  console.error(`    ${f.reason}`);
  console.error(`    Install / docs: ${f.url}`);
  console.error("");
}
console.error(dim("After resolving the items above, re-run the command."));
console.error("");
process.exit(1);

import { parseArgs } from "node:util";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const { values } = parseArgs({
  options: {
    directory: { type: "string" },
    port: { type: "string", default: "3000" },
  },
});
assert.ok(
  values.directory,
  "--directory must point to the prepared application",
);
const directory = resolve(values.directory);
const child = spawn(
  process.execPath,
  [
    join(directory, "node_modules/next/dist/bin/next"),
    "dev",
    directory,
    "--hostname",
    "127.0.0.1",
    "--port",
    values.port,
  ],
  { cwd: directory, stdio: "inherit", detached: true },
);
const stop = (signal) => {
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
};
process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

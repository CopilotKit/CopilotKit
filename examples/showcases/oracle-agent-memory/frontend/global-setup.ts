import { execFileSync } from "node:child_process";
import path from "node:path";

// Purge the demo user's durable memory before the suite so the cross-session
// recall test is deterministic (no stale facts from earlier runs). Runs the
// reset through the agent's venv via `uv`. Non-fatal: if it can't run, the
// suite still runs and any real DB problem surfaces in the tests themselves.
export default function globalSetup() {
  const frontendDir = __dirname;
  const agentDir = path.join(frontendDir, "..", "agent");
  const script = path.join(frontendDir, "e2e", "reset-memory.py");
  try {
    const out = execFileSync(
      "uv",
      ["run", "--directory", agentDir, "python", script],
      { encoding: "utf8", stdio: "pipe" },
    );
    process.stdout.write(out);
  } catch (err) {
    console.warn(
      `[global-setup] memory reset skipped: ${(err as Error).message}`,
    );
  }
}

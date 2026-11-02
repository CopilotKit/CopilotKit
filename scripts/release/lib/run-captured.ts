import { spawn } from "child_process";
import { ROOT } from "./config.js";

/**
 * Run a command to completion, capturing its output.
 *
 * Output is CAPTURED rather than inherited, then replayed as one block per
 * package once that package finishes. With a pool in flight, inheriting stdio
 * would interleave several npm publishes line-by-line and make the log
 * unreadable — and this log is the only forensic record when a publish fails.
 * A failure's message carries the full output, so callers can match on npm's
 * error text.
 */
export function runCaptured(
  cmd: string,
  args: string[],
  opts?: { cwd?: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts?.cwd ?? ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk) => (output += chunk));
    child.stderr?.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      if (status === 0) {
        resolve(output);
        return;
      }
      reject(
        new Error(
          `Command failed (exit ${status}): ${cmd} ${args.join(" ")}\n${output}`,
        ),
      );
    });
  });
}

import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";

/** Run bounded child commands, retain redacted diagnostics and never hide failure. */
export function commandRunner(
  output,
  secrets = [],
  { handleSignals = false } = {},
) {
  const active = new Set();
  let interruption;
  let cleanup = false;
  const interrupt = (signal) => {
    interruption ??= Object.assign(
      new Error(`Smoke run interrupted by ${signal}`),
      {
        signal,
        exitCode: signal === "SIGINT" ? 130 : 143,
      },
    );
    // Cleanup commands keep their deadlines, even after repeated interrupts.
    if (!cleanup) for (const cancel of active) cancel();
  };
  const handlers = new Map(
    ["SIGINT", "SIGTERM"].map((signal) => [signal, () => interrupt(signal)]),
  );
  if (handleSignals)
    for (const [signal, handler] of handlers) process.on(signal, handler);
  const run = async (
    file,
    args,
    {
      step,
      input,
      sensitive = false,
      cleanup: cleanupCommand = false,
      timeoutMs = 600_000,
      cwd,
      env = process.env,
    } = {},
  ) => {
    if (interruption && !cleanup && !cleanupCommand) throw interruption;
    if (!/^[a-z0-9-]+$/.test(step ?? ""))
      throw new Error("A safe command step name is required");
    const child = spawn(file, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let expired = false;
    let cancelled = false;
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    let expire;
    const terminate = () => {
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") stderr += String(error);
      }
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      expire();
    };
    const cancel = () => {
      cancelled = true;
      terminate();
    };
    if (!cleanupCommand) active.add(cancel);
    const timer = setTimeout(() => {
      expired = true;
      terminate();
    }, timeoutMs);
    let failure;
    try {
      const code = await new Promise((resolve, reject) => {
        expire = () => resolve(null);
        child.once("error", reject);
        child.once("close", resolve);
      });
      if (cancelled) failure = interruption;
      else if (expired || code !== 0)
        failure = new Error(
          `${step} ${expired ? "timeout" : `failed (exit ${code})`}; see ${step}.log`,
        );
    } catch (error) {
      failure = error;
    } finally {
      clearTimeout(timer);
      active.delete(cancel);
    }
    const redact = (text) =>
      secrets
        .filter(Boolean)
        .reduce(
          (value, secret) => value.replaceAll(secret, "[redacted]"),
          text,
        );
    await appendFile(
      join(output, `${step}.log`),
      redact((sensitive ? "[private stdout omitted]\n" : stdout) + stderr),
      { mode: 0o600 },
    );
    if (failure) throw failure;
    if (interruption && !cleanup && !cleanupCommand) throw interruption;
    return stdout;
  };
  Object.defineProperty(run, "interruption", { get: () => interruption });
  run.beginCleanup = () => {
    cleanup = true;
  };
  run.dispose = () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
  return run;
}

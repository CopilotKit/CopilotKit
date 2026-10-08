import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

/** Bounded importer execution; cancellation kills its owned process group. */
export async function runImporter(
  file,
  args,
  { env, signal, log, secrets = [], timeoutMs = 120_000 },
) {
  signal?.throwIfAborted();
  const child = spawn(file, args, {
    env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks = [];
  let size = 0;
  let failure;
  const stop = (reason) => {
    failure ??= reason;
    try {
      if (child.pid) {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      }
    } catch (error) {
      if (error.code !== "ESRCH")
        failure = new AggregateError(
          [failure, error],
          "Importer termination failed",
        );
    }
  };
  const record = (chunk) => {
    size += chunk.length;
    if (size <= 8 * 1024 * 1024) chunks.push(chunk);
    else stop(new Error("Importer diagnostics exceeded 8 MiB"));
  };
  child.stdout.on("data", record);
  child.stderr.on("data", record);
  const abort = () => stop(signal.reason ?? new Error("Importer aborted"));
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(
    () => stop(new Error("Importer timed out")),
    timeoutMs,
  );
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (failure) throw failure;
    if (code !== 0)
      throw Object.assign(new Error(`Importer failed (exit ${code})`), {
        exitCode: code,
      });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    const text = secrets
      .filter(Boolean)
      .reduce(
        (value, secret) => value.replaceAll(secret, "[redacted]"),
        Buffer.concat(chunks).toString("utf8"),
      );
    await writeFile(log, text, { mode: 0o600 });
  }
}

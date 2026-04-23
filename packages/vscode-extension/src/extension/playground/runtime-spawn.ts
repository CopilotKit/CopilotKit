import { spawn, type ChildProcess } from "node:child_process";
import type { LlmProvider } from "./llm-config";

export interface RuntimeSpawnConfig {
  port: number;
  llmBaseUrl: string;
  provider: LlmProvider;
  model: string;
  apiKey: string;
}

export interface RuntimeSpawnOptions {
  /** Absolute path to dist/runtime/subprocess-entry.cjs. */
  entryScript: string;
  config: RuntimeSpawnConfig;
  /** Max milliseconds to wait for the ready line. Default: 5000. */
  timeoutMs?: number;
}

export interface RuntimeHandle {
  url: string;
  stop(): Promise<void>;
}

/**
 * Forks dist/runtime/subprocess-entry.cjs as a child process, passing the
 * stringified config as argv[2]. Waits for the child to print
 * `{ "ready": true, "port": N }\n` to stdout, then resolves with a handle
 * whose `url` is http://127.0.0.1:N.
 *
 * stop() sends SIGTERM and resolves when the child exits. The subprocess
 * handles SIGTERM cleanly (closeAllConnections + server.close — see Task 5),
 * with a 2-second hard-exit fallback baked in. This wrapper additionally
 * adds its own 2-second timeout after which the promise resolves regardless,
 * so a hung child never deadlocks the extension.
 */
export function spawnRuntime(
  options: RuntimeSpawnOptions,
): Promise<RuntimeHandle> {
  const timeoutMs = options.timeoutMs ?? 5000;
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(
        process.execPath,
        [options.entryScript, JSON.stringify(options.config)],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch (err) {
      reject(err);
      return;
    }

    let stdoutBuf = "";
    let settled = false;

    const settleError = (err: Error) => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        /* best effort */
      }
      reject(err);
    };

    const settleOk = (url: string) => {
      if (settled) return;
      settled = true;
      resolve({
        url,
        stop: () =>
          new Promise<void>((resolveStop) => {
            child.once("exit", () => resolveStop());
            try {
              child.kill();
            } catch {
              /* best effort */
            }
            // Fallback in case the process doesn't exit cleanly.
            setTimeout(() => resolveStop(), 2000);
          }),
      });
    };

    const timer = setTimeout(() => {
      settleError(
        new Error(`Runtime subprocess didn't ready in ${timeoutMs}ms`),
      );
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const newlineIdx = stdoutBuf.indexOf("\n");
      if (newlineIdx < 0) return;
      const firstLine = stdoutBuf.slice(0, newlineIdx).trim();
      try {
        const msg = JSON.parse(firstLine) as { ready?: boolean; port?: number };
        if (msg.ready === true && typeof msg.port === "number") {
          clearTimeout(timer);
          settleOk(`http://127.0.0.1:${msg.port}`);
        }
      } catch {
        /* not the ready line — keep buffering */
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      settleError(err instanceof Error ? err : new Error(String(err)));
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (!settled) {
        settleError(
          new Error(
            `Runtime subprocess exited before ready (code=${code}, signal=${signal})`,
          ),
        );
      }
    });
  });
}

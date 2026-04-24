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
  /**
   * Max milliseconds to wait for the ready line. Default: 30000.
   *
   * Node cold-start on Windows loading `@copilotkit/runtime/v2` +
   * `@ai-sdk/openai` + `@ai-sdk/anthropic` measured ~15s end-to-end (the
   * dominant cost is the pnpm-resolved transitive require tree being fs-
   * stat'd at startup, plus Windows stdout pipe buffering adding ~10s on
   * top of the 2-3s actual require cost). 30s gives a comfortable margin.
   */
  timeoutMs?: number;
  /**
   * Optional sink for stderr and diagnostic events. Without it, the child's
   * stderr is silently dropped and the only feedback on failure is the
   * terse "didn't ready in Nms" message, which hides real crashes (bad
   * config JSON, module resolution failures, port bind errors, etc.).
   */
  logger?: (line: string) => void;
}

export interface RuntimeHandle {
  url: string;
  stop(): Promise<void>;
}

/**
 * Forks dist/runtime/subprocess-entry.cjs as a child process, passing the
 * stringified config via the COPILOTKIT_PLAYGROUND_CONFIG environment variable.
 * Waits for the child to print `{ "ready": true, "port": N }\n` to stdout,
 * then resolves with a handle whose `url` is http://127.0.0.1:N.
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
  const timeoutMs = options.timeoutMs ?? 30000;
  const log = options.logger ?? (() => {});
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    const startedAt = Date.now();
    try {
      log(`[runtime-spawn] forking ${options.entryScript}`);
      child = spawn(process.execPath, [options.entryScript], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          COPILOTKIT_PLAYGROUND_CONFIG: JSON.stringify(options.config),
        },
      });
    } catch (err) {
      reject(err);
      return;
    }

    let stdoutBuf = "";
    let stderrBuf = "";
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
            let exited = false;
            const finish = (): void => {
              if (exited) return;
              exited = true;
              clearTimeout(fallback);
              resolveStop();
            };
            child.once("exit", finish);
            try {
              child.kill();
            } catch {
              /* best effort */
            }
            const fallback = setTimeout(finish, 2000);
            fallback.unref();
          }),
      });
    };

    const timer = setTimeout(() => {
      const elapsed = Date.now() - startedAt;
      const tail = stderrBuf.trim().slice(-500);
      settleError(
        new Error(
          `Runtime subprocess didn't ready in ${timeoutMs}ms (elapsed=${elapsed}ms)` +
            (tail ? `\nstderr tail: ${tail}` : ""),
        ),
      );
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      // Scan ALL complete lines — not just the first. Earlier versions only
      // examined the first line, so if the child ever printed a non-ready
      // line before ready (debug output, warnings), the actual ready line
      // was missed forever. Consume lines and advance the buffer.
      let newlineIdx: number;
      while ((newlineIdx = stdoutBuf.indexOf("\n")) >= 0) {
        const line = stdoutBuf.slice(0, newlineIdx).trim();
        stdoutBuf = stdoutBuf.slice(newlineIdx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as { ready?: boolean; port?: number };
          if (msg.ready === true && typeof msg.port === "number") {
            clearTimeout(timer);
            log(
              `[runtime-spawn] ready on port ${msg.port} after ${
                Date.now() - startedAt
              }ms`,
            );
            settleOk(`http://127.0.0.1:${msg.port}`);
            return;
          }
        } catch {
          log(`[runtime-spawn stdout] ${line}`);
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuf += text;
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) log(`[runtime-spawn stderr] ${trimmed}`);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      settleError(err instanceof Error ? err : new Error(String(err)));
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (!settled) {
        const tail = stderrBuf.trim().slice(-500);
        settleError(
          new Error(
            `Runtime subprocess exited before ready (code=${code}, signal=${signal})` +
              (tail ? `\nstderr tail: ${tail}` : ""),
          ),
        );
      }
    });
  });
}

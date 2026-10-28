import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("D4 async diagnostic consumer containment", () => {
  it.each(["fulfilled", "rejecting"] as const)(
    "survives an async %s consumer under strict Node rejection handling",
    async (mode) => {
      const result = await new Promise<{
        error: string | null;
        code: string | number;
        signal: NodeJS.Signals | null;
        stdout: string;
        stderr: string;
      }>((resolve) => {
        execFile(
          process.execPath,
          [
            "--unhandled-rejections=strict",
            "--import",
            createRequire(import.meta.url).resolve("tsx"),
            fileURLToPath(
              new URL(
                "../../../test/fixtures/d4-request-failed/async-consumer.ts",
                import.meta.url,
              ),
            ),
            mode,
          ],
          { timeout: 5000, killSignal: "SIGKILL", encoding: "utf8" },
          (error, stdout, stderr) => {
            // execFile calls back after exit (including timeout termination),
            // so failures retain their evidence and every child is reaped.
            resolve({
              error: error?.message ?? null,
              code: error?.code ?? 0,
              signal: error?.signal ?? null,
              stdout,
              stderr,
            });
          },
        );
      });
      const evidence = JSON.stringify({
        mode,
        outcome: result.stderr.includes("D4_ASYNC_DIAGNOSTIC_CONSUMER")
          ? "named-async-consumer-rejection"
          : result.error
            ? "setup-import-or-other-failure"
            : "child-success",
        ...result,
      });
      // Print captured evidence even on failure; setup errors are not proof
      // that the named consumer rejection escaped the adapter.
      console.info(evidence);
      expect(result, evidence).toEqual({
        error: null,
        code: 0,
        signal: null,
        stdout: "D4_REQUEST_FAILED_ASYNC_CONSUMER_OK\n",
        stderr: "",
      });
    },
    10000,
  );
});

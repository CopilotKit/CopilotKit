import { z } from "zod";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import {
  computePinDrift,
  PinDriftBaselineError,
  type PinDriftResult,
} from "./pin-drift-core.js";
import { pinDriftProbe, type PinDriftSignal } from "../pin-drift.js";
import type { ProbeDriver } from "../types.js";
import type { ProbeContext, ProbeResult } from "../../types/index.js";

/**
 * Driver wrapper around `pinDriftProbe`. The existing probe stays the
 * state-machine authority (stable / regressed / improved / no_baseline);
 * this driver does the I/O the probe deliberately leaves out:
 *
 *   1. Reads the committed `showcase/scripts/fail-baseline.json` so the
 *      comparison ratchet is sourced from the same file CI uses — no
 *      divergent in-memory config.
 *   2. Runs `validate-pins.ts` as a child process to collect the current
 *      `[FAIL] ...` stderr lines, then calls `computePinDrift` (the
 *      extracted core module in `scripts/validate-pins-core.ts`) to
 *      derive count + hash + status. The shell ratchet in
 *      `.github/workflows/showcase_validate.yml` does the same
 *      comparison — core is the single source of truth for both paths.
 *   3. Maps the `PinDriftResult` into a `ProbeResult` whose signal shape
 *      is a superset of the legacy probe's signal (adds `hash`, `delta`,
 *      `failed[]`) so existing rules keyed on `setStatus` keep matching
 *      while new rules can ratchet on hash drift.
 *
 * The driver only emits a `state:"error"` ProbeResult when the baseline
 * file itself is unreadable / malformed OR the validator process crashes
 * unexpectedly. A validator that exits 0 or 1 (OK / drift) is NOT an
 * error — that's a legitimate signal and the comparison proceeds.
 */

const pinDriftInputSchema = z
  .object({
    key: z.string().min(1),
  })
  .passthrough();

type PinDriftDriverInput = z.infer<typeof pinDriftInputSchema>;

/** Superset signal: legacy fields + drift-set metadata from core. */
export interface PinDriftDriverSignal extends PinDriftSignal {
  hash: string;
  delta: number;
  failed: string[];
}

/**
 * Runner abstraction for tests. Production default spawns
 * `npx tsx showcase/scripts/validate-pins.ts` and collects stderr; tests
 * inject a synthetic runner so the driver suite doesn't fan out 134
 * subprocesses per test file.
 */
export interface ValidatePinsRunner {
  run(repoRoot: string): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
  }>;
}

/* c8 ignore start -- production spawning adapter; exercised via integration
   tests that actually invoke the validate-pins.ts CLI (too heavy for unit:
   spawns 134 subprocesses per run). Unit tests inject `mockRunner`. */
const defaultRunner: ValidatePinsRunner = {
  async run(repoRoot) {
    const scriptPath = path.resolve(
      repoRoot,
      "showcase",
      "scripts",
      "validate-pins.ts",
    );
    return new Promise((resolve, reject) => {
      const child = spawn("npx", ["tsx", scriptPath], {
        cwd: repoRoot,
        env: { ...process.env, VALIDATE_PINS_REPO_ROOT: repoRoot },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
      child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
      child.on("error", reject);
      child.on("close", (code) => resolve({ stdout, stderr, exitCode: code }));
    });
  },
};
/* c8 ignore stop */

/**
 * Resolve the repo root containing `showcase/scripts/fail-baseline.json`.
 * `ctx.env.PIN_DRIFT_REPO_ROOT` takes precedence so operators can point
 * the probe at a specific checkout (CI, worktree, …) without recompiling;
 * the fallback walks up from the driver file's location to the repo root
 * so a vanilla orchestrator boot works without any env wiring.
 */
function resolveRepoRoot(ctx: ProbeContext): string {
  const fromEnv = ctx.env.PIN_DRIFT_REPO_ROOT;
  if (fromEnv && fromEnv.trim() !== "") return fromEnv;
  // Default: walk up from src/probes/drivers/ to repo root. Matches the
  // relative layout: `showcase/ops/src/probes/drivers/pin-drift.ts`
  // → `../../../../..` → repo root.
  return path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
    "..",
    "..",
    "..",
  );
}

export function createPinDriftDriver(
  runner: ValidatePinsRunner = defaultRunner,
): ProbeDriver<PinDriftDriverInput, PinDriftDriverSignal> {
  return {
    kind: pinDriftProbe.dimension,
    inputSchema: pinDriftInputSchema,
    async run(ctx, input) {
      const { logger } = ctx;
      const repoRoot = resolveRepoRoot(ctx);
      const baselinePath = path.resolve(
        repoRoot,
        "showcase",
        "scripts",
        "fail-baseline.json",
      );

      // Read the baseline file. ENOENT is a real error — if the file is
      // missing, the ratchet has nothing to compare against and we must
      // surface that as a keyed synthetic error rather than silently
      // pretending we're on first-run. (Empty file is a separate case,
      // handled in core as `no_baseline`.)
      let failBaselineJson: string;
      try {
        failBaselineJson = fs.readFileSync(baselinePath, "utf8");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn("probe.pin-drift.baseline-read-failed", {
          baselinePath,
          error: msg,
        });
        return {
          key: input.key,
          state: "error",
          signal: {
            errorDesc: `failed to read fail-baseline.json at ${baselinePath}: ${msg}`,
          } as unknown as PinDriftDriverSignal,
          observedAt: ctx.now().toISOString(),
        };
      }

      // Run the validator. Exit codes 0 (no drift) and 1 (drift) are both
      // legitimate; anything else (2 internal crash, 3 unreadable input,
      // null/unknown) is a driver-level error.
      let runResult: Awaited<ReturnType<ValidatePinsRunner["run"]>>;
      try {
        runResult = await runner.run(repoRoot);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn("probe.pin-drift.runner-failed", { error: msg });
        return {
          key: input.key,
          state: "error",
          signal: {
            errorDesc: `validate-pins runner crashed: ${msg}`,
          } as unknown as PinDriftDriverSignal,
          observedAt: ctx.now().toISOString(),
        };
      }

      if (runResult.exitCode !== 0 && runResult.exitCode !== 1) {
        logger.warn("probe.pin-drift.validator-unexpected-exit", {
          exitCode: runResult.exitCode,
        });
        return {
          key: input.key,
          state: "error",
          signal: {
            errorDesc: `validate-pins exited ${runResult.exitCode} (expected 0 or 1)`,
          } as unknown as PinDriftDriverSignal,
          observedAt: ctx.now().toISOString(),
        };
      }

      // Parse stderr into the raw `failLines` shape the core module
      // consumes. Split on \n; the core then filters to [FAIL]-prefixed
      // lines and sort -u's them.
      const failLines = runResult.stderr.split("\n");

      let drift: PinDriftResult;
      try {
        drift = computePinDrift({
          failBaselineJson,
          currentWorkingState: { failLines },
        });
      } catch (e) {
        if (e instanceof PinDriftBaselineError) {
          logger.warn("probe.pin-drift.baseline-invalid", {
            error: e.message,
          });
          return {
            key: input.key,
            state: "error",
            signal: {
              errorDesc: e.message,
            } as unknown as PinDriftDriverSignal,
            observedAt: ctx.now().toISOString(),
          };
        }
        // Defensive re-raise: computePinDrift only throws
        // PinDriftBaselineError, but an unexpected runtime exception (e.g.
        // createHash failure, OOM) must propagate rather than silently
        // become a probe error. Not reachable through unit-level inputs.
        /* c8 ignore next */
        throw e;
      }

      // Now call the pure probe with the derived count / baseline —
      // the probe owns the setStatus enum and boolean flags the legacy
      // rule templates consume. We then decorate the signal with the
      // driver's additional fields (hash, delta, failed).
      const baselineForProbe =
        drift.status === "no_baseline" ? null : drift.baselineCount;
      const inner = await pinDriftProbe.run(
        {
          actualCount: drift.actualCount,
          baselineCount: baselineForProbe,
        },
        ctx,
      );

      // The probe hardcodes `key: "pin_drift:weekly"`; override with the
      // YAML-supplied key so operators can run multiple pin-drift probes
      // (e.g. per-integration) without key collision. Existing rules
      // keyed on `pin_drift:weekly` still match the YAML default.
      const signal: PinDriftDriverSignal = {
        ...inner.signal,
        // Drift-set override: the probe returns "stable" when counts
        // match, but hash drift is a regression. Re-set setStatus /
        // flags from the core result so the driver output reflects the
        // ratchet invariant, not just the count.
        setStatus: drift.status,
        stable: drift.status === "stable",
        regressed: drift.status === "regressed",
        improved: drift.status === "improved",
        noBaseline: drift.status === "no_baseline",
        hash: drift.hash,
        delta: drift.delta,
        failed: drift.failed,
      };

      return {
        key: input.key,
        state: inner.state,
        signal,
        observedAt: inner.observedAt,
      };
    },
  };
}

/** Default driver instance — uses the production spawning runner. */
export const pinDriftDriver = createPinDriftDriver();

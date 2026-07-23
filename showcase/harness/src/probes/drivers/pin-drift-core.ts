/**
 * Local mirror of `showcase/scripts/validate-pins-core.ts`. The two
 * modules MUST be kept in sync — they are the single source of truth
 * for pin-drift ratchet comparison, consumed by:
 *   - `showcase/scripts/validate-pins.ts` (CLI exports) and the CI shell
 *     ratchet in `.github/workflows/showcase_validate.yml`.
 *   - this driver (`../drivers/pin-drift.ts`), which runs in-cluster on
 *     the weekly schedule.
 *
 * They're duplicated because tsc's `rootDir: src` forbids importing
 * across package boundaries in the harness build. A bi-directional parity
 * test in `pin-drift-core.test.ts` imports both modules and drives the
 * same inputs through each, failing loudly if the implementations drift.
 *
 * Any change to drift comparison logic MUST land in BOTH files in the
 * same commit. The parity test is the enforcement mechanism — if you
 * edit only one side, the parity test flips red.
 */

import { createHash } from "crypto";

interface FailBaselineShape {
  validatePinsFailCount: number;
  validatePinsFailHash: string;
  [k: string]: unknown;
}

export interface PinDriftInput {
  failBaselineJson: string;
  currentWorkingState: unknown;
}

export type PinDriftStatus =
  | "stable"
  | "regressed"
  | "improved"
  | "no_baseline";

export interface PinDriftResult {
  status: PinDriftStatus;
  actualCount: number;
  baselineCount: number;
  delta: number;
  hash: string;
  failed: string[];
}

export class PinDriftBaselineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PinDriftBaselineError";
  }
}

function parseBaseline(jsonText: string): FailBaselineShape | null {
  if (jsonText.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new PinDriftBaselineError(
      `fail-baseline.json: JSON syntax error: ${msg}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new PinDriftBaselineError(
      "fail-baseline.json: expected top-level object",
    );
  }
  const obj = parsed as Record<string, unknown>;
  const c = obj.validatePinsFailCount;
  const h = obj.validatePinsFailHash;
  if (typeof c !== "number" || !Number.isInteger(c) || c < 0) {
    throw new PinDriftBaselineError(
      "fail-baseline.json: validatePinsFailCount must be a non-negative integer",
    );
  }
  if (typeof h !== "string" || !/^[0-9a-f]{64}$/.test(h)) {
    throw new PinDriftBaselineError(
      "fail-baseline.json: validatePinsFailHash must be a 64-char lowercase hex SHA-256",
    );
  }
  return obj as FailBaselineShape;
}

function extractFailed(state: unknown): string[] {
  if (typeof state !== "object" || state === null) {
    throw new PinDriftBaselineError(
      "currentWorkingState: expected object with failLines or failed array",
    );
  }
  const obj = state as Record<string, unknown>;
  let lines: string[] | undefined;
  if (Array.isArray(obj.failLines)) {
    lines = obj.failLines.filter((l): l is string => typeof l === "string");
  } else if (Array.isArray(obj.failed)) {
    lines = obj.failed.filter((l): l is string => typeof l === "string");
  }
  if (!lines) {
    throw new PinDriftBaselineError(
      "currentWorkingState: missing failLines or failed array",
    );
  }
  const normalized = Array.isArray(obj.failLines)
    ? lines.filter((l) => /^\[FAIL\]/.test(l))
    : lines;
  const deduped = Array.from(new Set(normalized));
  deduped.sort();
  return deduped;
}

function computeHash(failed: string[]): string {
  if (failed.length === 0) return "";
  const payload = failed.join("\n") + "\n";
  return createHash("sha256").update(payload).digest("hex");
}

export function computePinDrift(input: PinDriftInput): PinDriftResult {
  const baseline = parseBaseline(input.failBaselineJson);
  const failed = extractFailed(input.currentWorkingState);
  const actualCount = failed.length;
  const hash = computeHash(failed);

  if (baseline === null) {
    return {
      status: "no_baseline",
      actualCount,
      baselineCount: 0,
      delta: 0,
      hash,
      failed,
    };
  }

  const baselineCount = baseline.validatePinsFailCount;
  const baselineHash = baseline.validatePinsFailHash;
  const delta = actualCount - baselineCount;

  let status: PinDriftStatus;
  if (delta > 0) {
    status = "regressed";
  } else if (delta < 0) {
    status = "improved";
  } else if (hash !== baselineHash) {
    status = "regressed";
  } else {
    status = "stable";
  }

  return {
    status,
    actualCount,
    baselineCount,
    delta,
    hash,
    failed,
  };
}

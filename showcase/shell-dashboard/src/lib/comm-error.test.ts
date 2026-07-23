/**
 * REQ-B — dashboard-side decode of the pool COMM-ERROR signal.
 *
 * The harness mirrors a `PoolCommError` into a status row's `signal` under
 * `FLEET_COMM_ERROR_SIGNAL_KEY` (the persisted `State` enum is NOT widened).
 * These tests pin the dashboard reader (`commErrorFromStatusSignal`) and the
 * presentation surface (`FleetSurfaceState`) so an operator can tell "couldn't
 * reach the pool" apart from "the test went red".
 */
import { describe, it, expect } from "vitest";
import {
  commErrorFromStatusSignal,
  isPoolCommErrorKind,
  POOL_COMM_ERROR_KINDS,
  FLEET_COMM_ERROR_SIGNAL_KEY,
} from "./live-status";
import type { PoolCommError } from "./live-status";

function commError(overrides: Partial<PoolCommError> = {}): PoolCommError {
  return {
    kind: "worker-unreachable",
    message: "connect ECONNREFUSED 10.0.0.5:8080",
    workerId: "worker-7",
    jobId: "job-42",
    observedAt: "2026-06-04T12:00:00.000Z",
    ...overrides,
  };
}

function signalWith(err: unknown): Record<string, unknown> {
  return { [FLEET_COMM_ERROR_SIGNAL_KEY]: err };
}

describe("commErrorFromStatusSignal (REQ-B decode)", () => {
  it("decodes a well-formed comm error off the row signal", () => {
    const err = commError();
    const decoded = commErrorFromStatusSignal(signalWith(err));
    expect(decoded).toEqual(err);
  });

  it("preserves the kind + workerId so the tooltip can name them", () => {
    const decoded = commErrorFromStatusSignal(
      signalWith(
        commError({ kind: "worker-crashed-mid-job", workerId: "w-99" }),
      ),
    );
    expect(decoded?.kind).toBe("worker-crashed-mid-job");
    expect(decoded?.workerId).toBe("w-99");
  });

  it("omits optional fields when absent", () => {
    const decoded = commErrorFromStatusSignal(
      signalWith({
        kind: "claim-comm-failure",
        message: "CAS transport error",
        observedAt: "2026-06-04T12:00:00.000Z",
      }),
    );
    expect(decoded).toEqual({
      kind: "claim-comm-failure",
      message: "CAS transport error",
      observedAt: "2026-06-04T12:00:00.000Z",
    });
    expect(decoded).not.toHaveProperty("workerId");
    expect(decoded).not.toHaveProperty("jobId");
  });

  it("returns undefined when no comm error is present (a normal probe row)", () => {
    expect(commErrorFromStatusSignal({})).toBeUndefined();
    expect(commErrorFromStatusSignal({ someOtherField: 1 })).toBeUndefined();
  });

  it("returns undefined for null / non-object signals (fail-safe)", () => {
    expect(commErrorFromStatusSignal(null)).toBeUndefined();
    expect(commErrorFromStatusSignal(undefined)).toBeUndefined();
    expect(commErrorFromStatusSignal("a string")).toBeUndefined();
    expect(commErrorFromStatusSignal(42)).toBeUndefined();
  });

  it("returns undefined for a malformed comm error (bad kind / missing fields)", () => {
    expect(
      commErrorFromStatusSignal(
        signalWith({ kind: "not-a-real-kind", message: "x", observedAt: "y" }),
      ),
    ).toBeUndefined();
    // missing message
    expect(
      commErrorFromStatusSignal(
        signalWith({ kind: "worker-unreachable", observedAt: "y" }),
      ),
    ).toBeUndefined();
    // missing observedAt
    expect(
      commErrorFromStatusSignal(
        signalWith({ kind: "worker-unreachable", message: "x" }),
      ),
    ).toBeUndefined();
    // non-object payload under the key
    expect(commErrorFromStatusSignal(signalWith("oops"))).toBeUndefined();
  });
});

describe("isPoolCommErrorKind", () => {
  it("accepts every declared kind", () => {
    for (const kind of POOL_COMM_ERROR_KINDS) {
      expect(isPoolCommErrorKind(kind)).toBe(true);
    }
  });

  it("rejects unknown values and undefined", () => {
    expect(isPoolCommErrorKind("red")).toBe(false);
    expect(isPoolCommErrorKind(undefined)).toBe(false);
  });
});

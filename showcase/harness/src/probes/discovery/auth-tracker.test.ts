import { describe, it, expect, vi } from "vitest";
import { DiscoveryAuthTracker } from "./auth-tracker.js";
import {
  DiscoverySourceAuthError,
  DiscoverySourceTransportError,
} from "./errors.js";
import type { Logger, ProbeResult, WriteOutcome } from "../../types/index.js";
import type { StatusWriter } from "../../writers/status-writer.js";

// Helpers -------------------------------------------------------------------

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeWriter(): StatusWriter & { writes: ProbeResult<unknown>[] } {
  const writes: ProbeResult<unknown>[] = [];
  return {
    writes,
    write: vi.fn(
      async (result: ProbeResult<unknown>): Promise<WriteOutcome> => {
        writes.push(result);
        return {
          previousState: null,
          newState: result.state as "green" | "red" | "degraded",
          transition: "first",
          firstFailureAt: null,
          failCount: 0,
        };
      },
    ),
  };
}

// ---------------------------------------------------------------------------

describe("DiscoveryAuthTracker", () => {
  it("auth failures increment counter — threshold triggers write", async () => {
    const writer = makeWriter();
    const tracker = new DiscoveryAuthTracker({
      threshold: 3,
      writer,
      logger: makeLogger(),
      now: () => 1000,
    });

    const err = new DiscoverySourceAuthError(
      "railway-services",
      "401 Unauthorized",
    );

    await tracker.recordFailure("railway-services", err, "serving-stale");
    await tracker.recordFailure("railway-services", err, "serving-stale");
    expect(writer.writes).toHaveLength(0);

    await tracker.recordFailure("railway-services", err, "serving-stale");
    expect(writer.writes).toHaveLength(1);
  });

  it("non-auth failures do not increment counter", async () => {
    const writer = makeWriter();
    const tracker = new DiscoveryAuthTracker({
      threshold: 3,
      writer,
      logger: makeLogger(),
      now: () => 1000,
    });

    const err = new DiscoverySourceTransportError(
      "railway-services",
      "ECONNREFUSED",
    );

    for (let i = 0; i < 5; i++) {
      await tracker.recordFailure("railway-services", err, "serving-stale");
    }

    expect(writer.write).not.toHaveBeenCalled();
  });

  it("success resets counter", async () => {
    const writer = makeWriter();
    const tracker = new DiscoveryAuthTracker({
      threshold: 3,
      writer,
      logger: makeLogger(),
      now: () => 1000,
    });

    const err = new DiscoverySourceAuthError(
      "railway-services",
      "401 Unauthorized",
    );

    // Two auth failures (below threshold)
    await tracker.recordFailure("railway-services", err, "serving-stale");
    await tracker.recordFailure("railway-services", err, "serving-stale");

    // Success resets counter — isAlerting is false so no green write
    await tracker.recordSuccess("railway-services");

    // Two more auth failures (counter was reset, so still below threshold)
    await tracker.recordFailure("railway-services", err, "serving-stale");
    await tracker.recordFailure("railway-services", err, "serving-stale");

    // Writer should never have been called (never reached threshold)
    expect(writer.write).not.toHaveBeenCalled();
  });

  it("threshold crossing writes system status with state red", async () => {
    const writer = makeWriter();
    const tracker = new DiscoveryAuthTracker({
      threshold: 3,
      writer,
      logger: makeLogger(),
      now: () => 1000,
    });

    const err = new DiscoverySourceAuthError(
      "railway-services",
      "401 Unauthorized",
    );

    await tracker.recordFailure("railway-services", err, "serving-stale");
    await tracker.recordFailure("railway-services", err, "serving-stale");
    await tracker.recordFailure("railway-services", err, "serving-stale");

    expect(writer.writes).toHaveLength(1);
    const written = writer.writes[0]!;
    expect(written.key).toBe("system:discovery-auth-failed");
    expect(written.state).toBe("red");

    const signal = written.signal as Record<string, unknown>;
    expect(signal.errorMessage).toBe("401 Unauthorized");
    expect(signal.sourceName).toBe("railway-services");
    expect(signal.firstFailureAt).toBeTypeOf("string");
    expect(signal.authFailuresSinceSuccess).toBe(3);
    expect(signal.cacheStatus).toBe("serving-stale");
  });

  it("sustained alerting rate-limits writes to once per 5 minutes", async () => {
    const writer = makeWriter();
    let clock = 1000;
    const tracker = new DiscoveryAuthTracker({
      threshold: 3,
      writer,
      logger: makeLogger(),
      now: () => clock,
    });

    const err = new DiscoverySourceAuthError(
      "railway-services",
      "401 Unauthorized",
    );

    // Failures 1-3: threshold crossed on 3rd (clock=3000)
    clock = 1000;
    await tracker.recordFailure("railway-services", err, "serving-stale");
    clock = 2000;
    await tracker.recordFailure("railway-services", err, "serving-stale");
    clock = 3000;
    await tracker.recordFailure("railway-services", err, "serving-stale");
    expect(writer.writes).toHaveLength(1);

    // Failure 4 at clock=4000: only 1s after threshold write — suppressed
    clock = 4000;
    await tracker.recordFailure("railway-services", err, "serving-stale");
    expect(writer.writes).toHaveLength(1);

    // Failure 5 at clock=60_000: still under 5 minutes — suppressed
    clock = 60_000;
    await tracker.recordFailure("railway-services", err, "serving-stale");
    expect(writer.writes).toHaveLength(1);

    // Failure 6 at clock=303_001: >5 min after threshold write — written
    clock = 303_001;
    await tracker.recordFailure("railway-services", err, "serving-stale");
    expect(writer.writes).toHaveLength(2);

    const write1 = writer.writes[0]!;
    const write2 = writer.writes[1]!;

    const signal2 = write2.signal as Record<string, unknown>;
    expect(signal2.authFailuresSinceSuccess).toBe(6);

    // Second write should have a later observedAt
    expect(write2.observedAt > write1.observedAt).toBe(true);

    // Failure 7 shortly after — suppressed again (new 5m window)
    clock = 310_000;
    await tracker.recordFailure("railway-services", err, "serving-stale");
    expect(writer.writes).toHaveLength(2);
  });

  it("recovery writes green status", async () => {
    const writer = makeWriter();
    const tracker = new DiscoveryAuthTracker({
      threshold: 3,
      writer,
      logger: makeLogger(),
      now: () => 5000,
    });

    const err = new DiscoverySourceAuthError(
      "railway-services",
      "401 Unauthorized",
    );

    // Reach threshold
    await tracker.recordFailure("railway-services", err, "serving-stale");
    await tracker.recordFailure("railway-services", err, "serving-stale");
    await tracker.recordFailure("railway-services", err, "serving-stale");
    expect(writer.writes).toHaveLength(1);

    // Recovery
    await tracker.recordSuccess("railway-services");
    expect(writer.writes).toHaveLength(2);

    const recoveryWrite = writer.writes[1]!;
    expect(recoveryWrite.key).toBe("system:discovery-auth-failed");
    expect(recoveryWrite.state).toBe("green");

    const signal = recoveryWrite.signal as Record<string, unknown>;
    expect(signal.recovered).toBe(true);
    expect(signal.sourceName).toBe("railway-services");
    expect(signal.recoveredAt).toBeTypeOf("string");
  });

  it("signal includes cacheStatus", async () => {
    // Test with serving-stale
    const writer1 = makeWriter();
    const tracker1 = new DiscoveryAuthTracker({
      threshold: 3,
      writer: writer1,
      logger: makeLogger(),
      now: () => 1000,
    });

    const err = new DiscoverySourceAuthError(
      "railway-services",
      "401 Unauthorized",
    );

    await tracker1.recordFailure("railway-services", err, "serving-stale");
    await tracker1.recordFailure("railway-services", err, "serving-stale");
    await tracker1.recordFailure("railway-services", err, "serving-stale");

    const signal1 = writer1.writes[0]!.signal as Record<string, unknown>;
    expect(signal1.cacheStatus).toBe("serving-stale");

    // Test with no-cache
    const writer2 = makeWriter();
    const tracker2 = new DiscoveryAuthTracker({
      threshold: 3,
      writer: writer2,
      logger: makeLogger(),
      now: () => 1000,
    });

    await tracker2.recordFailure("railway-services", err, "no-cache");
    await tracker2.recordFailure("railway-services", err, "no-cache");
    await tracker2.recordFailure("railway-services", err, "no-cache");

    const signal2 = writer2.writes[0]!.signal as Record<string, unknown>;
    expect(signal2.cacheStatus).toBe("no-cache");
  });

  it("below-threshold is a no-op for writer", async () => {
    const writer = makeWriter();
    const tracker = new DiscoveryAuthTracker({
      threshold: 3,
      writer,
      logger: makeLogger(),
      now: () => 1000,
    });

    const err = new DiscoverySourceAuthError(
      "railway-services",
      "401 Unauthorized",
    );

    await tracker.recordFailure("railway-services", err, "serving-stale");
    await tracker.recordFailure("railway-services", err, "serving-stale");

    expect(writer.write).not.toHaveBeenCalled();
  });

  it("interleaved errors — transport does not reset auth counter", async () => {
    const writer = makeWriter();
    const tracker = new DiscoveryAuthTracker({
      threshold: 3,
      writer,
      logger: makeLogger(),
      now: () => 1000,
    });

    const authErr = new DiscoverySourceAuthError(
      "railway-services",
      "401 Unauthorized",
    );
    const transportErr = new DiscoverySourceTransportError(
      "railway-services",
      "ECONNREFUSED",
    );

    // auth-fail (counter: 1)
    await tracker.recordFailure("railway-services", authErr, "serving-stale");
    // auth-fail (counter: 2)
    await tracker.recordFailure("railway-services", authErr, "serving-stale");
    // transport-fail (no-op, counter stays at 2)
    await tracker.recordFailure(
      "railway-services",
      transportErr,
      "serving-stale",
    );
    // auth-fail (counter: 3 — threshold crossed)
    await tracker.recordFailure("railway-services", authErr, "serving-stale");

    expect(writer.writes).toHaveLength(1);
    const signal = writer.writes[0]!.signal as Record<string, unknown>;
    expect(signal.authFailuresSinceSuccess).toBe(3);
  });
});

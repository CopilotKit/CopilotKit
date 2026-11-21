import { describe, expect, test } from "vitest";
import {
  computeSamplingMeta,
  CONNECT_SAMPLE_RATE,
  sourceSampleRate,
  UNSAMPLED_RATE,
  TELEMETRY_EMITTER_V1,
  TELEMETRY_EMITTER_V2,
} from "./sampling";

describe("computeSamplingMeta", () => {
  test("anonymous callers get the population weight 1/sampleRate", () => {
    // The gate let 5% through, so each surviving event stands for 20.
    expect(
      computeSamplingMeta({ telemetryId: null, sampleRate: 0.05 }),
    ).toEqual({
      sampleRate: 0.05,
      sampleRateAdjustmentFactor: 0.95,
      sampleWeight: 20,
      telemetry_identified: false,
    });
  });

  test("identified callers get weight 1 — they bypassed the gate", () => {
    // The branch that matters: an identified event represents only itself,
    // so weighting it by the anonymous population's 20 would inflate every
    // paying customer's volume 20×.
    expect(
      computeSamplingMeta({ telemetryId: "abc-123", sampleRate: 0.05 }),
    ).toEqual({
      sampleRate: 1,
      sampleRateAdjustmentFactor: 0,
      sampleWeight: 1,
      telemetry_identified: true,
    });
  });

  test("telemetry_identified stays true when sampleRate=1 makes the weights identical", () => {
    // COPILOTKIT_TELEMETRY_SAMPLE_RATE=1 gives anonymous events weight 1
    // too, so weight alone stops separating the populations. This is the
    // case that makes the flag worth carrying rather than inferring
    // (OSS-1018).
    const anon = computeSamplingMeta({ telemetryId: null, sampleRate: 1 });
    const identified = computeSamplingMeta({
      telemetryId: "abc-123",
      sampleRate: 1,
    });

    expect(anon.sampleWeight).toBe(identified.sampleWeight);
    expect(anon.telemetry_identified).toBe(false);
    expect(identified.telemetry_identified).toBe(true);
  });

  test("an empty telemetry_id is anonymous, not identified", () => {
    // parseTelemetryIdFromLicense only returns strings or null, but a
    // token carrying `telemetry_id: ""` would otherwise read as identified
    // and silently bypass the sample gate.
    expect(
      computeSamplingMeta({ telemetryId: "", sampleRate: 0.05 }),
    ).toMatchObject({ sampleWeight: 20, telemetry_identified: false });
  });

  test("the two emitter markers are distinct", () => {
    // Downstream separates the populations by this value; if they ever
    // collide the dedupe rule silently keeps or drops both.
    expect(TELEMETRY_EMITTER_V1).not.toBe(TELEMETRY_EMITTER_V2);
  });
});

describe("sourceSampleRate", () => {
  const requestCreated = "oss.runtime.copilot_request_created";

  test("a connect request is gated at CONNECT_SAMPLE_RATE", () => {
    expect(sourceSampleRate(requestCreated, { requestType: "connect" })).toBe(
      CONNECT_SAMPLE_RATE,
    );
    expect(CONNECT_SAMPLE_RATE).toBeGreaterThan(0);
    expect(CONNECT_SAMPLE_RATE).toBeLessThan(1);
  });

  test("a run request is never gated", () => {
    // The denominator of the connect:run ratio stays an exact count.
    expect(sourceSampleRate(requestCreated, { requestType: "run" })).toBe(
      UNSAMPLED_RATE,
    );
  });

  test("other events are never gated, whatever their properties say", () => {
    expect(
      sourceSampleRate("oss.runtime.instance_created", {
        requestType: "connect",
      }),
    ).toBe(UNSAMPLED_RATE);
    expect(sourceSampleRate(requestCreated, undefined)).toBe(UNSAMPLED_RATE);
  });

  test("the gate composes into the block by multiplication", () => {
    // What a client passes after multiplying in its own rate: a connect
    // kept at 0.05 by the source and 0.5 by an opt-down stands for 40.
    const meta = computeSamplingMeta({
      telemetryId: null,
      sampleRate:
        0.5 *
        sourceSampleRate(requestCreated, {
          requestType: "connect",
        }),
    });
    expect(meta.sampleWeight).toBeCloseTo(1 / (0.5 * CONNECT_SAMPLE_RATE));
  });
});

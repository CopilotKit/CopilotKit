import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { MockInstance } from "vitest";
import { lambdaClient } from "@copilotkit/shared";
import { TelemetryClient } from "../telemetry-client";

// Guards the half of the sampling contract that lives in the v2 client:
// it gates anonymous events at sampleRate and lets identified ones
// through, so every event it emits has to record which branch it took.
// It didn't, and ~24% of runtime volume became unweightable from the data
// alone (OSS-1017 / OSS-1018).
describe("v2 TelemetryClient sampling metadata", () => {
  let lambdaSpy: MockInstance<typeof lambdaClient.send>;

  beforeEach(() => {
    lambdaSpy = vi.spyOn(lambdaClient, "send").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function jwtWith(payload: Record<string, unknown>): string {
    const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `header.${b64}.sig`;
  }

  const baseInstanceEvent = {
    actionsAmount: 0,
    endpointsAmount: 0,
    endpointTypes: [],
    "cloud.api_key_provided": false,
  } as never;

  function globalsOf(callIndex = 0): Record<string, unknown> {
    return lambdaSpy.mock.calls[callIndex][0].globalProperties as Record<
      string,
      unknown
    >;
  }

  test("anonymous events carry the 5% gate's weight of 20", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const client = new TelemetryClient({ sampleRate: 0.05 });

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(globalsOf()).toMatchObject({
      sampleRate: 0.05,
      sampleRateAdjustmentFactor: 0.95,
      sampleWeight: 20,
      telemetry_identified: false,
    });
  });

  test("identified events bypass the gate and carry weight 1", async () => {
    // Math.random would fail a 5% gate; the identified branch must send
    // anyway, and must not inherit the anonymous population's weight.
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const client = new TelemetryClient({ sampleRate: 0.05 });
    client.setLicenseToken(jwtWith({ telemetry_id: "abc-123" }));

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(lambdaSpy).toHaveBeenCalledTimes(1);
    expect(globalsOf()).toMatchObject({
      sampleRate: 1,
      sampleWeight: 1,
      telemetry_identified: true,
    });
  });

  test("events are stamped with the v2 emitter and its transport", async () => {
    // What lets a consumer attribute an event to this code path directly
    // instead of inferring it from $lib and which fields are absent.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const client = new TelemetryClient({ sampleRate: 0.05 });

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(globalsOf()).toMatchObject({
      telemetry_emitter: "v2-runtime",
      telemetry_transport: "lambda",
    });
  });

  test("sampling metadata does not displace caller globalProperties", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const client = new TelemetryClient({ sampleRate: 0.05 });
    client.setGlobalProperties({ "copilotkit.package.name": "runtime" });

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(globalsOf()).toMatchObject({
      "copilotkit.package.name": "runtime",
      sampleWeight: 20,
    });
  });

  test("the license token itself never reaches the event properties", async () => {
    // Only the decoded id travels, and only as a header. A regression here
    // would ship a signed JWT to the analytics sink on every event.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const token = jwtWith({ telemetry_id: "abc-123" });
    const client = new TelemetryClient({ sampleRate: 0.05 });
    client.setLicenseToken(token);

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    const sent = JSON.stringify([
      lambdaSpy.mock.calls[0][0].globalProperties,
      lambdaSpy.mock.calls[0][0].properties,
    ]);
    expect(sent).not.toContain(token);
    expect(sent).not.toContain("abc-123");
  });

  test("gated-out anonymous events send nothing at all", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const client = new TelemetryClient({ sampleRate: 0.05 });

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(lambdaSpy).not.toHaveBeenCalled();
  });
});

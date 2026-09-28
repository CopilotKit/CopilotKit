import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { MockInstance } from "vitest";
import { lambdaClient } from "@copilotkit/shared";
import { TelemetryClient } from "../telemetry-client";

// Guards the half of the sampling contract that lives in the v2 client.
// This client sends every event now, so the block it stamps is constant —
// but it still has to be stamped, and it still has to say whether the
// caller was identified. When it stamped nothing, ~24% of runtime volume
// became unweightable from the data alone (OSS-1017 / OSS-1018).
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

  test("anonymous events are sent unsampled and weigh 1", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const client = new TelemetryClient();

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(random).not.toHaveBeenCalled();
    expect(lambdaSpy).toHaveBeenCalledTimes(1);
    expect(globalsOf()).toMatchObject({
      sampleRate: 1,
      sampleRateAdjustmentFactor: 0,
      sampleWeight: 1,
      telemetry_identified: false,
    });
  });

  test("identified events are marked identified and carry weight 1", async () => {
    // Weight is the same on both branches now. telemetry_identified is
    // what keeps the two populations separable, which is why it is stated
    // outright instead of inferred from sampleWeight === 1 (OSS-1018).
    const client = new TelemetryClient();
    client.setLicenseToken(jwtWith({ telemetry_id: "abc-123" }));

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(lambdaSpy).toHaveBeenCalledTimes(1);
    expect(globalsOf()).toMatchObject({
      sampleRate: 1,
      sampleWeight: 1,
      telemetry_identified: true,
    });
  });

  test("events are stamped with the v2 emitter, surface, and transport", async () => {
    // What lets a consumer attribute an event to this code path directly
    // instead of inferring it from $lib and which fields are absent.
    const client = new TelemetryClient();

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(globalsOf()).toMatchObject({
      telemetry_emitter: "v2-runtime",
      telemetry_surface: "v2",
      telemetry_transport: "lambda",
    });
  });

  test("sampling metadata does not displace caller globalProperties", async () => {
    const client = new TelemetryClient();
    client.setGlobalProperties({ "copilotkit.package.name": "runtime" });

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(globalsOf()).toMatchObject({
      "copilotkit.package.name": "runtime",
      sampleWeight: 1,
    });
  });

  test("the license token itself never reaches the event properties", async () => {
    // Only the decoded id travels, and only as a header. A regression here
    // would ship a signed JWT to the analytics sink on every event.
    const token = jwtWith({ telemetry_id: "abc-123" });
    const client = new TelemetryClient();
    client.setLicenseToken(token);

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    const sent = JSON.stringify([
      lambdaSpy.mock.calls[0][0].globalProperties,
      lambdaSpy.mock.calls[0][0].properties,
    ]);
    expect(sent).not.toContain(token);
    expect(sent).not.toContain("abc-123");
  });

  test("nothing gates an anonymous event at the default rate", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const sending = new TelemetryClient({ telemetryDisabled: false });
    const disabled = new TelemetryClient({ telemetryDisabled: true });

    await sending.capture("oss.runtime.instance_created", baseInstanceEvent);
    await disabled.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(random).not.toHaveBeenCalled();
    expect(lambdaSpy).toHaveBeenCalledTimes(1);
  });

  test("a configured rate still gates, and the block reports it", async () => {
    // The lever survives for callers who want less; only the default moved.
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const gated = new TelemetryClient({
      telemetryDisabled: false,
      sampleRate: 0.05,
    });
    await gated.capture("oss.runtime.instance_created", baseInstanceEvent);
    expect(lambdaSpy).not.toHaveBeenCalled();

    vi.spyOn(Math, "random").mockReturnValue(0);
    await gated.capture("oss.runtime.instance_created", baseInstanceEvent);
    expect(globalsOf()).toMatchObject({ sampleRate: 0.05, sampleWeight: 20 });
  });
});

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { MockInstance } from "vitest";
import { CONNECT_SAMPLE_RATE, lambdaClient } from "@copilotkit/shared";
import { TelemetryClient } from "../telemetry-client";

// Guards the half of the sampling contract that lives in the v2 client.
// Apart from anonymous connect requests (covered below), this client sends
// every event, so the block it stamps is usually constant —
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

  test("an opt-out set after the client is created still stops events", async () => {
    // e.g. dotenv.config() placed below the import that creates the client.
    vi.stubEnv("COPILOTKIT_TELEMETRY_DISABLED", "");
    vi.stubEnv("DO_NOT_TRACK", "");
    try {
      const client = new TelemetryClient();
      vi.stubEnv("COPILOTKIT_TELEMETRY_DISABLED", "true");

      await client.capture("oss.runtime.instance_created", baseInstanceEvent);

      expect(lambdaSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
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

// One connect is sent per chat mount, so a single app can send hundreds per
// run while working perfectly. The source gate thins anonymous connects to
// CONNECT_SAMPLE_RATE and stamps the weight that keeps the true count and
// the connect:run ratio recoverable from sum(sampleWeight).
describe("v2 TelemetryClient connect sampling", () => {
  let lambdaSpy: MockInstance<typeof lambdaClient.send>;

  beforeEach(() => {
    lambdaSpy = vi.spyOn(lambdaClient, "send").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const request = (requestType: "connect" | "run") =>
    ({
      "cloud.guardrails.enabled": false,
      requestType,
      "cloud.api_key_provided": false,
    }) as const;

  function globalsOf(callIndex = 0): Record<string, unknown> {
    return lambdaSpy.mock.calls[callIndex][0].globalProperties as Record<
      string,
      unknown
    >;
  }

  test("an anonymous connect is dropped above the source rate and weighted when kept", async () => {
    const client = new TelemetryClient({ telemetryDisabled: false });

    vi.spyOn(Math, "random").mockReturnValue(CONNECT_SAMPLE_RATE);
    await client.capture(
      "oss.runtime.copilot_request_created",
      request("connect"),
    );
    expect(lambdaSpy).not.toHaveBeenCalled();

    vi.spyOn(Math, "random").mockReturnValue(0);
    await client.capture(
      "oss.runtime.copilot_request_created",
      request("connect"),
    );
    expect(lambdaSpy).toHaveBeenCalledTimes(1);
    expect(globalsOf()).toMatchObject({
      sampleRate: CONNECT_SAMPLE_RATE,
      sampleWeight: 1 / CONNECT_SAMPLE_RATE,
      telemetry_identified: false,
    });
  });

  test("a run is never sampled at the source", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const client = new TelemetryClient({ telemetryDisabled: false });

    await client.capture("oss.runtime.copilot_request_created", request("run"));

    expect(lambdaSpy).toHaveBeenCalledTimes(1);
    expect(globalsOf()).toMatchObject({ sampleRate: 1, sampleWeight: 1 });
  });

  test("an identified caller's connects are never sampled", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const client = new TelemetryClient({ telemetryDisabled: false });
    const payload = Buffer.from(
      JSON.stringify({ telemetry_id: "abc-123" }),
    ).toString("base64url");
    client.setLicenseToken(`header.${payload}.sig`);

    await client.capture(
      "oss.runtime.copilot_request_created",
      request("connect"),
    );

    expect(lambdaSpy).toHaveBeenCalledTimes(1);
    expect(globalsOf()).toMatchObject({
      sampleRate: 1,
      sampleWeight: 1,
      telemetry_identified: true,
    });
  });

  test("the source rate multiplies into a configured rate rather than replacing it", async () => {
    // 0.5 x CONNECT_SAMPLE_RATE. A draw between the product and the smaller
    // factor must drop the event, and a kept one stands for 1/product.
    const product = 0.5 * CONNECT_SAMPLE_RATE;
    const client = new TelemetryClient({
      telemetryDisabled: false,
      sampleRate: 0.5,
    });

    vi.spyOn(Math, "random").mockReturnValue(
      (product + CONNECT_SAMPLE_RATE) / 2,
    );
    await client.capture(
      "oss.runtime.copilot_request_created",
      request("connect"),
    );
    expect(lambdaSpy).not.toHaveBeenCalled();

    vi.spyOn(Math, "random").mockReturnValue(0);
    await client.capture(
      "oss.runtime.copilot_request_created",
      request("connect"),
    );
    expect(globalsOf().sampleRate).toBeCloseTo(product);
    expect(globalsOf().sampleWeight).toBeCloseTo(1 / product);
  });

  test("sum(sampleWeight) over kept connects recovers the true count", async () => {
    // Real Math.random. Binomial: the sum's standard deviation is
    // sqrt(N(1-p)/p); 6 sigma keeps this from flaking while still failing
    // on any weight that is off by more than a few percent.
    const n = 20_000;
    const client = new TelemetryClient({ telemetryDisabled: false });

    for (let i = 0; i < n; i++) {
      await client.capture(
        "oss.runtime.copilot_request_created",
        request("connect"),
      );
    }

    const total = lambdaSpy.mock.calls.reduce(
      (sum, [opts]) => sum + Number(opts.globalProperties?.sampleWeight),
      0,
    );
    const sigma = Math.sqrt(
      (n * (1 - CONNECT_SAMPLE_RATE)) / CONNECT_SAMPLE_RATE,
    );
    expect(lambdaSpy.mock.calls.length).toBeLessThan(n * 0.1);
    expect(Math.abs(total - n)).toBeLessThan(6 * sigma);
  });
});

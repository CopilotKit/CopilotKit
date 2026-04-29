import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelemetryClient } from "../telemetry/telemetry-client";
import scarfClient from "../telemetry/scarf-client";
import { lambdaClient } from "@copilotkit/shared";

describe("TelemetryClient", () => {
  let lambdaSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    lambdaSpy = vi.spyOn(lambdaClient, "send").mockResolvedValue(undefined);
  });

  afterEach(() => {
    lambdaSpy.mockRestore();
  });

  it("sends event to telemetry sink when sampled in", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const client = new TelemetryClient({
      telemetryDisabled: false,
      sampleRate: 1,
    });

    await client.capture("oss.runtime.instance_created", {
      actionsAmount: 0,
      endpointTypes: [],
      endpointsAmount: 0,
      "cloud.api_key_provided": false,
    });

    expect(lambdaSpy).toHaveBeenCalledTimes(1);
    expect(lambdaSpy.mock.calls[0][0]).toMatchObject({
      event: "oss.runtime.instance_created",
    });
  });

  it("forwards event properties to the sink", async () => {
    const client = new TelemetryClient({
      telemetryDisabled: false,
      sampleRate: 1,
    });

    await client.capture("oss.runtime.copilot_request_created", {
      "cloud.guardrails.enabled": true,
      requestType: "run",
      "cloud.api_key_provided": true,
      "cloud.public_api_key": "ck_live_abc123def456ghij.secret-blob",
    });

    expect(lambdaSpy).toHaveBeenCalledTimes(1);
    const arg = lambdaSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.event).toBe("oss.runtime.copilot_request_created");
    // Customer API keys are NOT used for telemetry attribution — only the
    // license token is. The cloud.public_api_key property still rides in
    // properties for downstream Segment/PostHog routing.
    expect(arg.licenseToken).toBeUndefined();
    expect(arg.properties).toMatchObject({
      requestType: "run",
      "cloud.api_key_provided": true,
      "cloud.public_api_key": "ck_live_abc123def456ghij.secret-blob",
    });
  });

  it("forwards license token (set via setLicenseToken) to the sink", async () => {
    const client = new TelemetryClient({
      telemetryDisabled: false,
      sampleRate: 1,
    });
    client.setLicenseToken("header.payload.signature");

    await client.capture("oss.runtime.instance_created", {
      actionsAmount: 0,
      endpointTypes: [],
      endpointsAmount: 0,
      "cloud.api_key_provided": false,
    });

    expect(lambdaSpy).toHaveBeenCalledTimes(1);
    const arg = lambdaSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.licenseToken).toBe("header.payload.signature");
  });

  it("does not send events when telemetryDisabled is true", async () => {
    const client = new TelemetryClient({
      telemetryDisabled: true,
      sampleRate: 1,
    });

    await client.capture("oss.runtime.instance_created", {
      actionsAmount: 0,
      endpointTypes: [],
      endpointsAmount: 0,
      "cloud.api_key_provided": false,
    });

    expect(lambdaSpy).not.toHaveBeenCalled();
  });

  it("does not send events when sampled out", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const client = new TelemetryClient({
      telemetryDisabled: false,
      sampleRate: 0.05,
    });

    await client.capture("oss.runtime.instance_created", {
      actionsAmount: 0,
      endpointTypes: [],
      endpointsAmount: 0,
      "cloud.api_key_provided": false,
    });

    expect(lambdaSpy).not.toHaveBeenCalled();
  });

  it("respects sample rate boundary", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.04);
    const client = new TelemetryClient({
      telemetryDisabled: false,
      sampleRate: 0.05,
    });

    await client.capture("oss.runtime.agent_execution_stream_started", {});

    expect(lambdaSpy).toHaveBeenCalled();
  });

  it("throws when sample rate is out of range", () => {
    expect(() => new TelemetryClient({ sampleRate: 1.5 })).toThrow(
      "Sample rate must be between 0 and 1",
    );
    expect(() => new TelemetryClient({ sampleRate: -0.1 })).toThrow(
      "Sample rate must be between 0 and 1",
    );
  });
});

describe("ScarfClient", () => {
  let originalFetch: typeof fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends GET request to scarf gateway with event as query param", async () => {
    await scarfClient.logEvent({ event: "oss.runtime.instance_created" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("https://copilotkit.gateway.scarf.sh/");
    expect(url).toContain("event=oss.runtime.instance_created");
    expect(options.method).toBe("GET");
  });

  it("silently fails on network error", async () => {
    fetchMock.mockRejectedValue(new Error("Network error"));

    // Should not throw
    await expect(
      scarfClient.logEvent({ event: "oss.runtime.instance_created" }),
    ).resolves.toBeUndefined();
  });

  it("silently fails on non-ok response", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));

    // Should not throw
    await expect(
      scarfClient.logEvent({ event: "oss.runtime.instance_created" }),
    ).resolves.toBeUndefined();
  });

  it("skips null and undefined values in query params", async () => {
    await scarfClient.logEvent({
      event: "oss.runtime.instance_created",
      nullVal: null,
      undefinedVal: undefined,
      validVal: "test",
    });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("event=oss.runtime.instance_created");
    expect(url).toContain("validVal=test");
    expect(url).not.toContain("nullVal");
    expect(url).not.toContain("undefinedVal");
  });
});

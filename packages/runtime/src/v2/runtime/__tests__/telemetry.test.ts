import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelemetryClient } from "../telemetry/telemetry-client";
import scarfClient from "../telemetry/scarf-client";

describe("TelemetryClient", () => {
  let scarfSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    scarfSpy = vi.spyOn(scarfClient, "logEvent").mockResolvedValue(undefined);
  });

  afterEach(() => {
    scarfSpy.mockRestore();
  });

  it("sends event to scarf when sampled in", async () => {
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

    expect(scarfSpy).toHaveBeenCalledWith({
      event: "oss.runtime.instance_created",
    });
  });

  it("only sends event name to scarf, not properties", async () => {
    const client = new TelemetryClient({
      telemetryDisabled: false,
      sampleRate: 1,
    });

    await client.capture("oss.runtime.copilot_request_created", {
      "cloud.guardrails.enabled": true,
      requestType: "run",
      "cloud.api_key_provided": true,
      "cloud.public_api_key": "pk_test_123",
    });

    expect(scarfSpy).toHaveBeenCalledWith({
      event: "oss.runtime.copilot_request_created",
    });
    // Properties should NOT be forwarded to scarf
    const callArg = scarfSpy.mock.calls[0][0];
    expect(Object.keys(callArg)).toEqual(["event"]);
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

    expect(scarfSpy).not.toHaveBeenCalled();
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

    expect(scarfSpy).not.toHaveBeenCalled();
  });

  it("respects sample rate boundary", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.04);
    const client = new TelemetryClient({
      telemetryDisabled: false,
      sampleRate: 0.05,
    });

    await client.capture("oss.runtime.agent_execution_stream_started", {});

    expect(scarfSpy).toHaveBeenCalled();
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

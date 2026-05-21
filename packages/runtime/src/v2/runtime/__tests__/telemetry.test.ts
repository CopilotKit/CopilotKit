import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TelemetryClient } from "../telemetry/telemetry-client";
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
    // Real JWT shape with telemetry_id in the payload — keeps
    // setLicenseToken from emitting the unparseable-token warning.
    const payload = Buffer.from('{"telemetry_id":"abc-123"}').toString(
      "base64url",
    );
    const token = `header.${payload}.sig`;

    const client = new TelemetryClient({
      telemetryDisabled: false,
      sampleRate: 1,
    });
    client.setLicenseToken(token);

    await client.capture("oss.runtime.instance_created", {
      actionsAmount: 0,
      endpointTypes: [],
      endpointsAmount: 0,
      "cloud.api_key_provided": false,
    });

    expect(lambdaSpy).toHaveBeenCalledTimes(1);
    const arg = lambdaSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.licenseToken).toBe(token);
  });

  it("warns once when setLicenseToken receives a token with no telemetry_id", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const client = new TelemetryClient({
        telemetryDisabled: false,
        sampleRate: 1,
      });
      const payload = Buffer.from('{"license_id":"foo"}').toString("base64url");
      client.setLicenseToken(`header.${payload}.sig`);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(/telemetry_id/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does not warn when setLicenseToken receives a token with telemetry_id", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const client = new TelemetryClient({
        telemetryDisabled: false,
        sampleRate: 1,
      });
      const payload = Buffer.from('{"telemetry_id":"abc-123"}').toString(
        "base64url",
      );
      client.setLicenseToken(`header.${payload}.sig`);

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
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

import { describe, it, expect, test, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import { TelemetryClient } from "../telemetry/telemetry-client";
import type { RuntimeInstanceCreatedInfo } from "../telemetry/events";
import { lambdaClient } from "@copilotkit/shared";

const baseInstanceEvent: RuntimeInstanceCreatedInfo = {
  actionsAmount: 0,
  endpointTypes: [],
  endpointsAmount: 0,
  "cloud.api_key_provided": false,
};
const legacyLicenseToken = `header.${Buffer.from(
  '{"telemetry_id":"legacy-license-id"}',
).toString("base64url")}.sig`;

describe("V2 telemetry identity sampling", () => {
  let lambdaSpy: MockInstance<typeof lambdaClient.send>;

  beforeEach(() => {
    lambdaSpy = vi.spyOn(lambdaClient, "send").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test.each([
    { label: "configured directly", priorLicenseToken: undefined },
    {
      label: "replacing a legacy license identity",
      priorLicenseToken: legacyLicenseToken,
    },
  ])(
    "standalone identity remains sample-gated when $label",
    async ({ priorLicenseToken }) => {
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
      const client = new TelemetryClient({
        telemetryDisabled: false,
        sampleRate: 0.05,
      });
      if (priorLicenseToken !== undefined) {
        client.setLicenseToken(priorLicenseToken);
      }
      client.setTelemetryIdentity({ telemetryId: "standalone-id" });

      await client.capture("oss.runtime.instance_created", baseInstanceEvent);

      expect(randomSpy).toHaveBeenCalledTimes(1);
      expect(lambdaSpy).not.toHaveBeenCalled();
    },
  );

  test("sampled standalone identity reaches the sink only as a transport claim", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const client = new TelemetryClient({
      telemetryDisabled: false,
      sampleRate: 0.05,
    });
    client.setTelemetryIdentity({ telemetryId: "standalone-id" });

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(randomSpy).toHaveBeenCalledTimes(1);
    expect(lambdaSpy).toHaveBeenCalledTimes(1);
    expect(lambdaSpy.mock.calls[0][0]).toMatchObject({
      licenseToken: undefined,
      telemetryId: "standalone-id",
    });
  });

  test("legacy license identity bypasses anonymous sampling", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const client = new TelemetryClient({
      telemetryDisabled: false,
      sampleRate: 0.05,
    });
    client.setLicenseToken(legacyLicenseToken);

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(randomSpy).not.toHaveBeenCalled();
    expect(lambdaSpy).toHaveBeenCalledTimes(1);
    expect(lambdaSpy.mock.calls[0][0]).toMatchObject({
      licenseToken: legacyLicenseToken,
      telemetryId: undefined,
    });
  });

  test.each(["", " \t "])(
    "V2 blank standalone identity %j falls through to a supplied legacy identity",
    async (blankTelemetryId) => {
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
      const client = new TelemetryClient({
        telemetryDisabled: false,
        sampleRate: 0.05,
      });
      client.setTelemetryIdentity({
        telemetryId: blankTelemetryId,
        licenseToken: legacyLicenseToken,
      });

      await client.capture("oss.runtime.instance_created", baseInstanceEvent);

      expect(randomSpy).not.toHaveBeenCalled();
      expect(lambdaSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          licenseToken: legacyLicenseToken,
          telemetryId: undefined,
        }),
      );
    },
  );

  test.each(["", " \t "])(
    "V2 blank standalone identity %j without a legacy identity remains anonymously sampled",
    async (blankTelemetryId) => {
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
      const client = new TelemetryClient({
        telemetryDisabled: false,
        sampleRate: 0.05,
      });
      client.setTelemetryIdentity({ telemetryId: blankTelemetryId });

      await client.capture("oss.runtime.instance_created", baseInstanceEvent);

      expect(randomSpy).toHaveBeenCalledTimes(1);
      expect(lambdaSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          licenseToken: undefined,
          telemetryId: undefined,
        }),
      );
    },
  );
});

describe("TelemetryClient", () => {
  let lambdaSpy: MockInstance<typeof lambdaClient.send>;

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
    const arg = lambdaSpy.mock.calls[0][0];
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
    const arg = lambdaSpy.mock.calls[0][0];
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

  it("throws on NaN sampleRate from a malformed env override", () => {
    // parseFloat('nonsense') = NaN. Without Number.isNaN in the validator,
    // NaN slips past the range check and produces a silent always-drop.
    const original = process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE;
    process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE = "not-a-number";
    try {
      expect(() => new TelemetryClient({ telemetryDisabled: false })).toThrow(
        "Sample rate must be between 0 and 1",
      );
    } finally {
      if (original === undefined) {
        delete process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE;
      } else {
        process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE = original;
      }
    }
  });

  it("default sampleRate=0.05 gates anonymous callers when no rate is configured", async () => {
    // Pins the 0.05 default so a future refactor reverting to 1.0 fails
    // loudly instead of silently restoring the OSS-runtime firehose this
    // PR is designed to cap.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const client = new TelemetryClient({ telemetryDisabled: false });

    await client.capture("oss.runtime.instance_created", {
      actionsAmount: 0,
      endpointTypes: [],
      endpointsAmount: 0,
      "cloud.api_key_provided": false,
    });

    expect(lambdaSpy).not.toHaveBeenCalled();
  });

  it("malformed license token stays anonymous and remains sample-gated", async () => {
    // parseTelemetryIdFromLicense returns null for empty/wrong-shape/parse
    // failure. A misconfigured customer must not flip to identified-bypass.
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new TelemetryClient({
      telemetryDisabled: false,
      sampleRate: 0.05,
    });

    client.setLicenseToken("not-a-jwt");
    await client.capture("oss.runtime.instance_created", {
      actionsAmount: 0,
      endpointTypes: [],
      endpointsAmount: 0,
      "cloud.api_key_provided": false,
    });

    expect(lambdaSpy).not.toHaveBeenCalled();
  });

  it("setLicenseToken cache is overwritable (good token replaced by bad → back to anonymous gate)", async () => {
    // Pins last-write-wins so a refactor to first-write-wins
    // (`this.telemetryId ??= parseAndWarnTelemetryId(...)`) doesn't leak
    // identified-bypass status across license replacements.
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new TelemetryClient({
      telemetryDisabled: false,
      sampleRate: 0.05,
    });

    const good = `header.${Buffer.from('{"telemetry_id":"abc-123"}').toString(
      "base64url",
    )}.sig`;
    const bad = `header.${Buffer.from('{"license_id":"no-tid"}').toString(
      "base64url",
    )}.sig`;
    client.setLicenseToken(good);
    client.setLicenseToken(bad);

    await client.capture("oss.runtime.instance_created", {
      actionsAmount: 0,
      endpointTypes: [],
      endpointsAmount: 0,
      "cloud.api_key_provided": false,
    });

    expect(lambdaSpy).not.toHaveBeenCalled();
  });

  it("identified callers send on every capture", async () => {
    // Default sampleRate is 0.05, but identified callers (telemetry_id
    // present) bypass the gate entirely. Two captures, two sends — no
    // Math.random mock needed.
    const payload = Buffer.from('{"telemetry_id":"abc-123"}').toString(
      "base64url",
    );
    const token = `header.${payload}.sig`;

    const client = new TelemetryClient({ telemetryDisabled: false });
    client.setLicenseToken(token);

    await client.capture("oss.runtime.instance_created", {
      actionsAmount: 0,
      endpointTypes: [],
      endpointsAmount: 0,
      "cloud.api_key_provided": false,
    });
    await client.capture("oss.runtime.instance_created", {
      actionsAmount: 0,
      endpointTypes: [],
      endpointsAmount: 0,
      "cloud.api_key_provided": false,
    });

    expect(lambdaSpy).toHaveBeenCalledTimes(2);
  });
});

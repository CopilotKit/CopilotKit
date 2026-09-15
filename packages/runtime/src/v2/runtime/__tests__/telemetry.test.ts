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
const malformedLegacyLicenseToken = `header.${Buffer.from(
  '{"telemetry_id":"legacy-license-id"}',
).toString("base64url")}$.sig`;
const callerSampleRate = process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE;
const callerTelemetryDisabled = process.env.COPILOTKIT_TELEMETRY_DISABLED;
const callerDoNotTrack = process.env.DO_NOT_TRACK;

beforeEach(() => {
  delete process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE;
  delete process.env.COPILOTKIT_TELEMETRY_DISABLED;
  delete process.env.DO_NOT_TRACK;
});

afterEach(() => {
  if (callerSampleRate === undefined) {
    delete process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE;
  } else {
    process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE = callerSampleRate;
  }
  if (callerTelemetryDisabled === undefined) {
    delete process.env.COPILOTKIT_TELEMETRY_DISABLED;
  } else {
    process.env.COPILOTKIT_TELEMETRY_DISABLED = callerTelemetryDisabled;
  }
  if (callerDoNotTrack === undefined) {
    delete process.env.DO_NOT_TRACK;
  } else {
    process.env.DO_NOT_TRACK = callerDoNotTrack;
  }
});

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
    "standalone identity does not make an event identified when $label",
    async ({ priorLicenseToken }) => {
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
      const client = new TelemetryClient({ telemetryDisabled: false });
      if (priorLicenseToken !== undefined) {
        client.setLicenseToken(priorLicenseToken);
      }
      client.setTelemetryIdentity({ telemetryId: "standalone-id" });

      await client.capture("oss.runtime.instance_created", baseInstanceEvent);

      expect(randomSpy).not.toHaveBeenCalled();
      expect(lambdaSpy.mock.calls[0][0].globalProperties).toMatchObject({
        telemetry_identified: false,
      });
    },
  );

  test("standalone identity reaches the sink only as a transport claim", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const client = new TelemetryClient({ telemetryDisabled: false });
    client.setTelemetryIdentity({ telemetryId: "standalone-id" });

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(randomSpy).not.toHaveBeenCalled();
    expect(lambdaSpy).toHaveBeenCalledTimes(1);
    expect(lambdaSpy.mock.calls[0][0]).toMatchObject({
      licenseToken: undefined,
      telemetryId: "standalone-id",
    });
  });

  test("legacy license identity is forwarded to the sink", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const client = new TelemetryClient({ telemetryDisabled: false });
    client.setLicenseToken(legacyLicenseToken);

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(randomSpy).not.toHaveBeenCalled();
    expect(lambdaSpy).toHaveBeenCalledTimes(1);
    expect(lambdaSpy.mock.calls[0][0]).toMatchObject({
      licenseToken: legacyLicenseToken,
      telemetryId: undefined,
    });
  });

  test("illegal base64url license payload cannot buy identified status", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = new TelemetryClient({ telemetryDisabled: false });
    client.setLicenseToken(malformedLegacyLicenseToken);

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(randomSpy).not.toHaveBeenCalled();
    expect(lambdaSpy.mock.calls[0][0]).toMatchObject({
      licenseToken: malformedLegacyLicenseToken,
    });
    expect(lambdaSpy.mock.calls[0][0].globalProperties).toMatchObject({
      telemetry_identified: false,
    });
  });

  test.each(["", " \t "])(
    "V2 blank standalone identity %j falls through to a supplied legacy identity",
    async (blankTelemetryId) => {
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
      const client = new TelemetryClient({ telemetryDisabled: false });
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
    "V2 blank standalone identity %j without a legacy identity stays anonymous",
    async (blankTelemetryId) => {
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
      const client = new TelemetryClient({ telemetryDisabled: false });
      client.setTelemetryIdentity({ telemetryId: blankTelemetryId });

      await client.capture("oss.runtime.instance_created", baseInstanceEvent);

      expect(randomSpy).not.toHaveBeenCalled();
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

  it("sends event to telemetry sink", async () => {
    const client = new TelemetryClient({ telemetryDisabled: false });

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
    const client = new TelemetryClient({ telemetryDisabled: false });

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

    const client = new TelemetryClient({ telemetryDisabled: false });
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
      const client = new TelemetryClient({ telemetryDisabled: false });
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
      const client = new TelemetryClient({ telemetryDisabled: false });
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
    const client = new TelemetryClient({ telemetryDisabled: true });

    await client.capture("oss.runtime.instance_created", {
      actionsAmount: 0,
      endpointTypes: [],
      endpointsAmount: 0,
      "cloud.api_key_provided": false,
    });

    expect(lambdaSpy).not.toHaveBeenCalled();
  });

  test.each([
    ["COPILOTKIT_TELEMETRY_DISABLED", "true"],
    ["COPILOTKIT_TELEMETRY_DISABLED", "1"],
    ["DO_NOT_TRACK", "true"],
    ["DO_NOT_TRACK", "1"],
  ] as const)(
    "%s=%s remains authoritative when telemetryDisabled is false",
    async (environmentVariable, value) => {
      process.env[environmentVariable] = value;
      const client = new TelemetryClient({ telemetryDisabled: false });

      await client.capture("oss.runtime.instance_created", baseInstanceEvent);

      expect(lambdaSpy).not.toHaveBeenCalled();
    },
  );

  it("sends anonymous events that the old 5% gate would have dropped", async () => {
    // Math.random=0.99 against the former 0.05 default. This is the
    // behaviour change, stated as a test: nothing about an anonymous
    // caller stops the event now.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const client = new TelemetryClient({ telemetryDisabled: false });

    await client.capture("oss.runtime.instance_created", {
      actionsAmount: 0,
      endpointTypes: [],
      endpointsAmount: 0,
      "cloud.api_key_provided": false,
    });

    expect(randomSpy).not.toHaveBeenCalled();
    expect(lambdaSpy).toHaveBeenCalledTimes(1);
  });

  it("ignores COPILOTKIT_TELEMETRY_SAMPLE_RATE, including an unparseable one", async () => {
    // The knob is gone from this client rather than left as dead
    // configuration. A malformed value used to throw out of the
    // constructor, which meant a typo in an env var could fail runtime
    // construction outright; now it is simply not read.
    process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE = "not-a-number";
    const client = new TelemetryClient({ telemetryDisabled: false });

    await client.capture("oss.runtime.instance_created", {
      actionsAmount: 0,
      endpointTypes: [],
      endpointsAmount: 0,
      "cloud.api_key_provided": false,
    });

    expect(lambdaSpy).toHaveBeenCalledTimes(1);
  });

  it("malformed license token stays anonymous without being dropped", async () => {
    // parseTelemetryIdFromLicense returns null for empty/wrong-shape/parse
    // failure. A misconfigured customer must not flip to identified.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new TelemetryClient({ telemetryDisabled: false });

    client.setLicenseToken("not-a-jwt");
    await client.capture("oss.runtime.instance_created", {
      actionsAmount: 0,
      endpointTypes: [],
      endpointsAmount: 0,
      "cloud.api_key_provided": false,
    });

    expect(lambdaSpy.mock.calls[0][0].globalProperties).toMatchObject({
      telemetry_identified: false,
    });
  });

  it("setLicenseToken cache is overwritable (good token replaced by bad → back to anonymous)", async () => {
    // Pins last-write-wins so a refactor to first-write-wins
    // (`this.telemetryId ??= parseAndWarnTelemetryId(...)`) doesn't leak
    // identified status across license replacements.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new TelemetryClient({ telemetryDisabled: false });

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

    expect(lambdaSpy.mock.calls[0][0].globalProperties).toMatchObject({
      telemetry_identified: false,
    });
  });

  it("identified callers send on every capture", async () => {
    // Two captures, two sends. Nothing sampled either of them out before
    // this change either, because identified callers bypassed the gate.
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

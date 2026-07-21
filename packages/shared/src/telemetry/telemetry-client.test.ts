import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { MockInstance } from "vitest";
import { lambdaClient } from "./lambda-client";
import { TelemetryClient, isTelemetryDisabled } from "./telemetry-client";

// Module mock so constructing TelemetryClient doesn't spin up segment's
// internal flush queue. Class-based (not vi.fn) so `vi.restoreAllMocks()`
// between tests doesn't wipe the `track` binding on subsequent `new
// Analytics(...)` calls.
const { segmentTrackMock } = vi.hoisted(() => ({
  segmentTrackMock: vi.fn(),
}));
vi.mock("@segment/analytics-node", () => ({
  Analytics: class {
    track = segmentTrackMock;
  },
}));

function jwtWith(payload: {
  telemetry_id?: string;
  license_id?: string;
}): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${b64}.sig`;
}

type TelemetryIdentityMode =
  | { label: "standalone"; telemetryId: string }
  | { label: "legacy license"; licenseToken: string }
  | { label: "anonymous" };

/** Applies the identity path under test without conflating legacy and standalone APIs. */
function applyTelemetryIdentity(
  client: TelemetryClient,
  identity: TelemetryIdentityMode,
) {
  if ("telemetryId" in identity) {
    client.setTelemetryIdentity({ telemetryId: identity.telemetryId });
    return;
  }

  if ("licenseToken" in identity) {
    client.setLicenseToken(identity.licenseToken);
  }
}

const telemetryIdentityModes = [
  {
    label: "standalone",
    telemetryId: "standalone-telemetry-id",
  },
  {
    label: "legacy license",
    licenseToken: jwtWith({ telemetry_id: "legacy-telemetry-id" }),
  },
  { label: "anonymous" },
] satisfies readonly TelemetryIdentityMode[];

const telemetryOptOuts = [
  { environmentVariable: "COPILOTKIT_TELEMETRY_DISABLED", value: "true" },
  { environmentVariable: "DO_NOT_TRACK", value: "1" },
] as const;

const telemetryOptOutCases = telemetryOptOuts.flatMap((optOut) =>
  telemetryIdentityModes.map((identity) => ({ identity, optOut })),
);

describe("v1 TelemetryClient", () => {
  let lambdaSpy: MockInstance<typeof lambdaClient.send>;

  beforeEach(() => {
    lambdaSpy = vi.spyOn(lambdaClient, "send").mockResolvedValue(undefined);
    segmentTrackMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function makeClient(
    overrides: Partial<ConstructorParameters<typeof TelemetryClient>[0]> = {},
  ): TelemetryClient {
    return new TelemetryClient({
      packageName: "@copilotkit/shared",
      packageVersion: "1.0.0",
      sampleRate: 1,
      ...overrides,
    });
  }

  const baseInstanceEvent = {
    actionsAmount: 0,
    endpointsAmount: 0,
    endpointTypes: [],
    "cloud.api_key_provided": false,
  } as const;
  const flattenedBaseInstanceEvent = {
    actionsAmount: 0,
    endpointsAmount: 0,
    "cloud.api_key_provided": false,
  } as const;

  test("capture sends to both sinks when sampled in (anonymous, one decision gates both)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const client = makeClient({ sampleRate: 0.05 });

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(lambdaSpy).toHaveBeenCalledTimes(1);
    expect(segmentTrackMock).toHaveBeenCalledTimes(1);
    expect(segmentTrackMock.mock.calls[0][0]).toMatchObject({
      event: "oss.runtime.instance_created",
    });
  });

  test("capture skips both sinks when anonymous and sampled out", async () => {
    // Math.random=0.99 vs sampleRate=0.05 — anonymous caller is gated out;
    // neither sink should fire under the new one-decision-both-sinks model.
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const client = makeClient({ sampleRate: 0.05 });

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(lambdaSpy).not.toHaveBeenCalled();
    expect(segmentTrackMock).not.toHaveBeenCalled();
  });

  test.each([
    {
      identity: { telemetryId: "standalone-telemetry-id" },
      identityValues: ["standalone-telemetry-id"],
      label: "standalone",
    },
    {
      identity: {
        licenseToken: jwtWith({ telemetry_id: "legacy-telemetry-id" }),
      },
      identityValues: [
        "legacy-telemetry-id",
        jwtWith({ telemetry_id: "legacy-telemetry-id" }),
      ],
      label: "legacy license",
    },
  ])(
    "$label identity bypasses sampling for both sinks with the effective rate",
    async ({ identity, identityValues }) => {
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
      const client = makeClient({ sampleRate: 0.05 });
      client.setTelemetryIdentity(identity);

      await client.capture("oss.runtime.instance_created", baseInstanceEvent);

      expect(randomSpy).not.toHaveBeenCalled();
      expect(lambdaSpy).toHaveBeenCalledTimes(1);
      const lambdaEvent = lambdaSpy.mock.calls[0][0];
      expect(lambdaEvent).toMatchObject({
        ...identity,
        globalProperties: {
          sampleRate: 1,
          sampleRateAdjustmentFactor: 0,
          sampleWeight: 1,
        },
      });
      expect(lambdaEvent.properties).toEqual(flattenedBaseInstanceEvent);
      expect(lambdaEvent.globalProperties).toEqual({
        "copilotkit.package.name": "@copilotkit/shared",
        "copilotkit.package.version": "1.0.0",
        sampleRate: 1,
        sampleRateAdjustmentFactor: 0,
        sampleWeight: 1,
      });
      expect(segmentTrackMock).toHaveBeenCalledTimes(1);
      const segmentEvent = segmentTrackMock.mock.calls[0][0];
      expect(segmentEvent).toEqual({
        anonymousId: expect.stringMatching(/^anon_/),
        event: "oss.runtime.instance_created",
        properties: {
          ...flattenedBaseInstanceEvent,
          "copilotkit.package.name": "@copilotkit/shared",
          "copilotkit.package.version": "1.0.0",
          sampleRate: 1,
          sampleRateAdjustmentFactor: 0,
          sampleWeight: 1,
        },
      });
      expect(segmentEvent).not.toHaveProperty("userId");
      const transportPayload = JSON.stringify({
        lambdaGlobalProperties: lambdaEvent.globalProperties,
        lambdaProperties: lambdaEvent.properties,
        segmentEvent,
      });
      for (const identityValue of identityValues) {
        expect(transportPayload).not.toContain(identityValue);
      }
    },
  );

  test("clearing telemetry identity restores one anonymous sampling decision for both sinks", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    const client = makeClient({ sampleRate: 0.05 });
    client.setTelemetryIdentity({ telemetryId: "standalone-telemetry-id" });
    client.setTelemetryIdentity({});

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(randomSpy).toHaveBeenCalledTimes(1);
    expect(lambdaSpy).toHaveBeenCalledTimes(1);
    expect(lambdaSpy.mock.calls[0][0]).toMatchObject({
      licenseToken: undefined,
      telemetryId: undefined,
      globalProperties: {
        sampleRate: 0.05,
        sampleRateAdjustmentFactor: 0.95,
        sampleWeight: 20,
      },
    });
    expect(segmentTrackMock).toHaveBeenCalledTimes(1);
    expect(segmentTrackMock.mock.calls[0][0]).toMatchObject({
      properties: expect.objectContaining({
        sampleRate: 0.05,
        sampleRateAdjustmentFactor: 0.95,
        sampleWeight: 20,
      }),
    });
  });

  test.each(["", " \t "])(
    "blank standalone identity %j falls through to a supplied legacy identity",
    async (blankTelemetryId) => {
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
      const licenseToken = jwtWith({ telemetry_id: "legacy-telemetry-id" });
      const client = makeClient({ sampleRate: 0.05 });
      client.setTelemetryIdentity({
        telemetryId: blankTelemetryId,
        licenseToken,
      });

      await client.capture("oss.runtime.instance_created", baseInstanceEvent);

      expect(randomSpy).not.toHaveBeenCalled();
      expect(lambdaSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          licenseToken,
          telemetryId: undefined,
          globalProperties: expect.objectContaining({ sampleRate: 1 }),
        }),
      );
    },
  );

  test.each(["", " \t "])(
    "blank standalone identity %j without a legacy identity remains anonymously sampled",
    async (blankTelemetryId) => {
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
      const client = makeClient({ sampleRate: 0.05 });
      client.setTelemetryIdentity({ telemetryId: blankTelemetryId });

      await client.capture("oss.runtime.instance_created", baseInstanceEvent);

      expect(randomSpy).toHaveBeenCalledTimes(1);
      expect(lambdaSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          licenseToken: undefined,
          telemetryId: undefined,
          globalProperties: expect.objectContaining({ sampleRate: 0.05 }),
        }),
      );
    },
  );

  test("identified callers bypass the sample gate (lambda + segment fire even when Math.random would fail)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const client = makeClient({ sampleRate: 0.05 });
    client.setLicenseToken(jwtWith({ telemetry_id: "abc-123" }));

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(lambdaSpy).toHaveBeenCalledTimes(1);
    expect(segmentTrackMock).toHaveBeenCalledTimes(1);
  });

  test("identified callers send to both sinks on every capture", async () => {
    const client = makeClient({ sampleRate: 0.05 });
    client.setLicenseToken(jwtWith({ telemetry_id: "abc-123" }));

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);
    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(lambdaSpy).toHaveBeenCalledTimes(2);
    expect(segmentTrackMock).toHaveBeenCalledTimes(2);
  });

  test("capture short-circuits both sinks when telemetryDisabled is true", async () => {
    const client = makeClient({ telemetryDisabled: true });

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(lambdaSpy).not.toHaveBeenCalled();
    expect(segmentTrackMock).not.toHaveBeenCalled();
  });

  test.each(telemetryOptOutCases)(
    "$optOut.environmentVariable disables both sinks for $identity.label telemetry",
    async ({ identity, optOut }) => {
      vi.stubEnv(optOut.environmentVariable, optOut.value);
      const client = makeClient();
      applyTelemetryIdentity(client, identity);

      await client.capture("oss.runtime.instance_created", baseInstanceEvent);

      expect(lambdaSpy).not.toHaveBeenCalled();
      expect(segmentTrackMock).not.toHaveBeenCalled();
    },
  );

  test("setLicenseToken forwards the token in subsequent capture", async () => {
    const token = jwtWith({ telemetry_id: "abc-123" });
    const client = makeClient();
    client.setLicenseToken(token);

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(lambdaSpy).toHaveBeenCalledTimes(1);
    expect(lambdaSpy.mock.calls[0][0].licenseToken).toBe(token);
  });

  test("capture sends licenseToken=undefined when setLicenseToken was never called", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const client = makeClient();

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(lambdaSpy.mock.calls[0][0].licenseToken).toBeUndefined();
  });

  test("setLicenseToken warns once when the token has no telemetry_id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = makeClient();

    client.setLicenseToken(jwtWith({ license_id: "x" }));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/telemetry_id/);
  });

  test("setLicenseToken does not warn when the token carries telemetry_id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = makeClient();

    client.setLicenseToken(jwtWith({ telemetry_id: "abc-123" }));

    expect(warn).not.toHaveBeenCalled();
  });

  test("identified events carry sampleWeight=1 (anonymous events carry 1/sampleRate)", async () => {
    // Anonymous: sampleWeight should be 1 / sampleRate so downstream
    // weight-based extrapolation reconstructs true volume.
    // Identified: bypassing the gate means each event represents itself,
    // so sampleWeight must be 1 — not the population's 1/sampleRate.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const anonClient = makeClient({ sampleRate: 0.05 });
    await anonClient.capture("oss.runtime.instance_created", baseInstanceEvent);
    expect(lambdaSpy.mock.calls[0][0].globalProperties).toMatchObject({
      sampleRate: 0.05,
      sampleWeight: 20,
    });
    expect(segmentTrackMock.mock.calls[0][0]).toMatchObject({
      properties: expect.objectContaining({
        sampleRate: 0.05,
        sampleWeight: 20,
      }),
    });

    lambdaSpy.mockClear();
    segmentTrackMock.mockReset();

    const idClient = makeClient({ sampleRate: 0.05 });
    idClient.setLicenseToken(jwtWith({ telemetry_id: "abc-123" }));
    await idClient.capture("oss.runtime.instance_created", baseInstanceEvent);
    expect(lambdaSpy.mock.calls[0][0].globalProperties).toMatchObject({
      sampleRate: 1,
      sampleWeight: 1,
    });
    expect(segmentTrackMock.mock.calls[0][0]).toMatchObject({
      properties: expect.objectContaining({ sampleRate: 1, sampleWeight: 1 }),
    });
  });

  test("malformed license token stays anonymous and remains sample-gated", async () => {
    // parseTelemetryIdFromLicense returns null for any of: empty token,
    // wrong-shape (not three dot-separated segments), base64/JSON parse
    // failure. A misconfigured customer must not flip to identified-bypass.
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = makeClient({ sampleRate: 0.05 });

    client.setLicenseToken("not-a-jwt");
    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(lambdaSpy).not.toHaveBeenCalled();
    expect(segmentTrackMock).not.toHaveBeenCalled();
  });

  test("setLicenseToken cache is overwritable (good token replaced by bad → back to anonymous gate)", async () => {
    // Pins the cache as last-write-wins so a refactor to first-write-wins
    // (e.g. `this.telemetryId ??= parseAndWarnTelemetryId(...)`) doesn't
    // leak identified-bypass status across license replacements.
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = makeClient({ sampleRate: 0.05 });

    client.setLicenseToken(jwtWith({ telemetry_id: "abc-123" }));
    client.setLicenseToken(jwtWith({ license_id: "no-telemetry-id" }));
    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    expect(lambdaSpy).not.toHaveBeenCalled();
    expect(segmentTrackMock).not.toHaveBeenCalled();
  });

  test("setCloudConfiguration writes cloud keys into globalProperties for both sinks", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const client = makeClient({ sampleRate: 1 });
    client.setCloudConfiguration({
      publicApiKey: "ck_live_test.secret",
      baseUrl: "https://api.cloud.copilotkit.ai",
    });

    await client.capture("oss.runtime.instance_created", baseInstanceEvent);

    // v1 still ships cloud.publicApiKey through globalProperties — the
    // lambda-client.send sanitization strips it at the wire (covered in
    // lambda-client.test.ts), and Segment retains it intentionally for
    // existing CopilotCloud user analytics.
    expect(lambdaSpy.mock.calls[0][0].globalProperties).toMatchObject({
      "cloud.publicApiKey": "ck_live_test.secret",
      "cloud.baseUrl": "https://api.cloud.copilotkit.ai",
    });
    expect(segmentTrackMock.mock.calls[0][0]).toMatchObject({
      properties: expect.objectContaining({
        "cloud.publicApiKey": "ck_live_test.secret",
        "cloud.baseUrl": "https://api.cloud.copilotkit.ai",
      }),
    });
  });

  test("constructor rejects sampleRate outside [0, 1]", () => {
    expect(() => makeClient({ sampleRate: 1.5 })).toThrow(
      "Sample rate must be between 0 and 1",
    );
    expect(() => makeClient({ sampleRate: -0.1 })).toThrow(
      "Sample rate must be between 0 and 1",
    );
  });

  test("constructor rejects NaN sampleRate from a malformed env override", () => {
    // parseFloat('nonsense') = NaN; without the explicit guard, NaN slips
    // past the range check (all NaN comparisons are false) and produces a
    // silent always-drop. Guard the validator with Number.isNaN.
    const original = process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE;
    process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE = "not-a-number";
    try {
      expect(() => makeClient()).toThrow("Sample rate must be between 0 and 1");
    } finally {
      if (original === undefined) {
        delete process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE;
      } else {
        process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE = original;
      }
    }
  });
});

describe("isTelemetryDisabled", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test.each([
    ["COPILOTKIT_TELEMETRY_DISABLED", "true"],
    ["COPILOTKIT_TELEMETRY_DISABLED", "1"],
    ["DO_NOT_TRACK", "true"],
    ["DO_NOT_TRACK", "1"],
  ])("returns true when %s=%s", (key, val) => {
    process.env[key] = val;
    expect(isTelemetryDisabled()).toBe(true);
  });

  test("returns false when no opt-out env var is set", () => {
    delete process.env.COPILOTKIT_TELEMETRY_DISABLED;
    delete process.env.DO_NOT_TRACK;
    expect(isTelemetryDisabled()).toBe(false);
  });
});

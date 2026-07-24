import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { parseTelemetryIdFromLicense, send } from "./lambda-client";

const EXPECTED_TELEMETRY_SINK_URL =
  process.env.COPILOTKIT_TELEMETRY_URL ??
  "https://telemetry.copilotkit.ai/ingest";
const TELEMETRY_ID_HEADER = "x-copilotkit-telemetry-id";
const LEGACY_IDENTITY_PAYLOAD = Buffer.from(
  JSON.stringify({ telemetry_id: "legacy-telemetry-id" }),
).toString("base64url");
const INVALID_BASE64URL_PAYLOADS = [
  {
    label: "a dollar sign",
    payload: `${LEGACY_IDENTITY_PAYLOAD}$`,
  },
  {
    label: "a space",
    payload: `${LEGACY_IDENTITY_PAYLOAD} `,
  },
  {
    label: "a line break",
    payload: `${LEGACY_IDENTITY_PAYLOAD}\n`,
  },
  {
    label: "an impossible length",
    payload: `${Buffer.from(JSON.stringify({ telemetry_id: "xx" })).toString(
      "base64url",
    )}A`,
  },
] as const;

test("normalizes surrounding HTTP whitespace in a legacy license identity", () => {
  const telemetryId = "\t legacy-telemetry-id \t";
  const payload = Buffer.from(
    JSON.stringify({ telemetry_id: telemetryId }),
  ).toString("base64url");

  expect(parseTelemetryIdFromLicense(`header.${payload}.sig`)).toBe(
    "legacy-telemetry-id",
  );
});

test("decodes a UTF-8 legacy identity in the browser fallback", () => {
  const payload = Buffer.from(
    JSON.stringify({ telemetry_id: "tenant-é" }),
  ).toString("base64url");
  vi.stubGlobal("Buffer", undefined);

  try {
    expect(parseTelemetryIdFromLicense(`header.${payload}.sig`)).toBe(
      "tenant-é",
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

test.each(INVALID_BASE64URL_PAYLOADS)(
  "rejects a legacy payload with $label in Node and the browser fallback",
  ({ payload }) => {
    const token = `header.${payload}.sig`;

    expect(parseTelemetryIdFromLicense(token)).toBeNull();

    vi.stubGlobal("Buffer", undefined);
    try {
      expect(parseTelemetryIdFromLicense(token)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

/**
 * Captures the telemetry request without replacing fetch with an untyped mock.
 */
function setupCapturedRequest() {
  let capturedRequest:
    | {
        bodyText: string;
        headers: Record<string, string>;
        rawTelemetryIdHeader: string | undefined;
        url: string;
      }
    | undefined;
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input, init) => {
      if (typeof init?.body !== "string") {
        throw new Error("Expected telemetry request body to be a string");
      }
      if (
        init.headers === undefined ||
        init.headers instanceof Headers ||
        Array.isArray(init.headers)
      ) {
        throw new Error("Expected telemetry request headers to be a record");
      }

      capturedRequest = {
        bodyText: init.body,
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        rawTelemetryIdHeader:
          init.headers["X-CopilotKit-Telemetry-Id"] ?? undefined,
        url: String(input),
      };
      return Promise.resolve(new Response("", { status: 202 }));
    });

  const readRequest = () => {
    if (!capturedRequest) {
      throw new Error("Expected telemetry send to reach fetch successfully");
    }
    return capturedRequest;
  };

  return {
    readRequest,
    teardown: () => fetchMock.mockRestore(),
  };
}

test.each(["bad\nid", "bad\u0000id", "tenant-🚀"])(
  "header-invalid legacy identity %j sends anonymously instead of dropping the event",
  async (invalidTelemetryId) => {
    const payload = Buffer.from(
      JSON.stringify({ telemetry_id: invalidTelemetryId }),
    ).toString("base64url");
    const { readRequest, teardown } = setupCapturedRequest();

    try {
      await send({
        event: "oss.runtime.instance_created",
        licenseToken: `header.${payload}.sig`,
      });

      expect(readRequest().rawTelemetryIdHeader).toBeUndefined();
    } finally {
      teardown();
    }
  },
);

test.each(INVALID_BASE64URL_PAYLOADS)(
  "legacy payload with $label sends anonymously in Node and the browser fallback",
  async ({ payload }) => {
    const { readRequest, teardown } = setupCapturedRequest();
    const sendMalformedToken = () =>
      send({
        event: "oss.runtime.instance_created",
        licenseToken: `header.${payload}.sig`,
      });

    try {
      await sendMalformedToken();
      expect(readRequest().rawTelemetryIdHeader).toBeUndefined();

      vi.stubGlobal("Buffer", undefined);
      await sendMalformedToken();
      expect(readRequest().rawTelemetryIdHeader).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
      teardown();
    }
  },
);

describe("lambda-client send()", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 202 }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function bodyOf(callIdx = 0): {
    properties: Record<string, unknown>;
    global_properties: Record<string, unknown>;
  } {
    const init = fetchMock.mock.calls[callIdx][1] as RequestInit;
    return JSON.parse(init.body as string);
  }

  function headersOf(callIdx = 0): Record<string, string> {
    const init = fetchMock.mock.calls[callIdx][1] as RequestInit;
    return init.headers as Record<string, string>;
  }

  test("strips cloud.public_api_key from properties before sending", async () => {
    await send({
      event: "oss.runtime.copilot_request_created",
      properties: {
        requestType: "run",
        "cloud.api_key_provided": true,
        "cloud.public_api_key": "ck_live_abc.secret-blob",
      },
    });

    const body = bodyOf();
    expect(body.properties).not.toHaveProperty("cloud.public_api_key");
    // Boolean indicator stays — it's not the key itself.
    expect(body.properties).toMatchObject({
      requestType: "run",
      "cloud.api_key_provided": true,
    });
  });

  test("strips cloud.publicApiKey from globalProperties (v1 camelCase variant)", async () => {
    await send({
      event: "oss.runtime.instance_created",
      globalProperties: {
        "cloud.publicApiKey": "ck_live_abc.secret-blob",
        "cloud.baseUrl": "https://api.cloud.copilotkit.ai",
        sampleRate: 0.05,
      },
    });

    const body = bodyOf();
    expect(body.global_properties).not.toHaveProperty("cloud.publicApiKey");
    // baseUrl is unrelated to attribution and rides through.
    expect(body.global_properties).toMatchObject({
      "cloud.baseUrl": "https://api.cloud.copilotkit.ai",
      sampleRate: 0.05,
    });
  });

  test("emits X-CopilotKit-Telemetry-Id when license JWT carries telemetry_id", async () => {
    const payload = Buffer.from('{"telemetry_id":"abc-123"}').toString(
      "base64url",
    );
    const token = `header.${payload}.sig`;

    await send({
      event: "oss.runtime.instance_created",
      licenseToken: token,
    });

    expect(headersOf()["X-CopilotKit-Telemetry-Id"]).toBe("abc-123");
  });

  test("falls through to anonymous when license JWT has no telemetry_id", async () => {
    const payload = Buffer.from('{"license_id":"foo"}').toString("base64url");
    const token = `header.${payload}.sig`;

    await send({
      event: "oss.runtime.instance_created",
      licenseToken: token,
    });

    expect(headersOf()["X-CopilotKit-Telemetry-Id"]).toBeUndefined();
  });

  test("falls through to anonymous when license token isn't a JWT shape", async () => {
    await send({
      event: "oss.runtime.instance_created",
      licenseToken: "not-a-jwt",
    });

    expect(headersOf()["X-CopilotKit-Telemetry-Id"]).toBeUndefined();
  });

  test("swallows fetch errors silently", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    await expect(
      send({ event: "oss.runtime.instance_created" }),
    ).resolves.toBeUndefined();
  });
});

const lambdaIdentityTransportCases = [
  {
    label: "standalone identity over a legacy license identity",
    explicitTelemetryId: "explicit-telemetry-id",
    licenseTelemetryId: "license-telemetry-id",
    expectedTelemetryId: "explicit-telemetry-id",
  },
  {
    label: "normalized standalone identity over a legacy license identity",
    explicitTelemetryId: "\t explicit-telemetry-id \t",
    licenseTelemetryId: "license-telemetry-id",
    expectedTelemetryId: "explicit-telemetry-id",
  },
  {
    label: "legacy license identity without a standalone identity",
    explicitTelemetryId: undefined,
    licenseTelemetryId: "license-telemetry-id",
    expectedTelemetryId: "license-telemetry-id",
  },
  {
    label: "legacy license identity with an empty standalone identity",
    explicitTelemetryId: "",
    licenseTelemetryId: "license-telemetry-id",
    expectedTelemetryId: "license-telemetry-id",
  },
  {
    label: "legacy license identity with a whitespace-only standalone identity",
    explicitTelemetryId: " \t ",
    licenseTelemetryId: "license-telemetry-id",
    expectedTelemetryId: "license-telemetry-id",
  },
  {
    label: "legacy license identity with a header-invalid standalone identity",
    explicitTelemetryId: "bad\nid",
    licenseTelemetryId: "license-telemetry-id",
    expectedTelemetryId: "license-telemetry-id",
  },
] as const;

test.each(lambdaIdentityTransportCases)(
  "sends $label only through the telemetry identity header",
  async ({ explicitTelemetryId, licenseTelemetryId, expectedTelemetryId }) => {
    const payload = Buffer.from(
      JSON.stringify({ telemetry_id: licenseTelemetryId }),
    ).toString("base64url");
    const licenseToken = `header.${payload}.sig`;
    const { readRequest, teardown } = setupCapturedRequest();

    try {
      await send({
        event: "oss.runtime.instance_created",
        properties: { requestType: "run" },
        globalProperties: { sampleRate: 0.25 },
        packageName: "@copilotkit/runtime",
        packageVersion: "1.2.3",
        licenseToken,
        telemetryId: explicitTelemetryId,
      });

      const { bodyText, headers, rawTelemetryIdHeader, url } = readRequest();
      expect(url).toBe(EXPECTED_TELEMETRY_SINK_URL);
      expect(rawTelemetryIdHeader).toBe(expectedTelemetryId);
      expect(headers).toEqual({
        "content-type": "application/json",
        [TELEMETRY_ID_HEADER]: expectedTelemetryId,
        "user-agent": "CopilotKit-Runtime/1.2.3 (@copilotkit/runtime)",
      });
      expect(JSON.parse(bodyText)).toEqual({
        event: "oss.runtime.instance_created",
        properties: { requestType: "run" },
        global_properties: { sampleRate: 0.25 },
        package: {
          name: "@copilotkit/runtime",
          version: "1.2.3",
        },
        ts: expect.any(Number),
      });

      const nonIdentityHeaders = Object.entries(headers).filter(
        ([name]) => name !== TELEMETRY_ID_HEADER,
      );
      const nonIdentityHeaderText = JSON.stringify(nonIdentityHeaders);
      for (const identity of [explicitTelemetryId, licenseTelemetryId]) {
        if (identity === undefined || identity.trim().length === 0) continue;
        expect(url).not.toContain(identity);
        expect(bodyText).not.toContain(identity);
        expect(nonIdentityHeaderText).not.toContain(identity);
      }
    } finally {
      teardown();
    }
  },
);

test.each(["", " \t "])(
  "blank standalone identity %j without a legacy identity sends no identity header",
  async (blankTelemetryId) => {
    const { readRequest, teardown } = setupCapturedRequest();

    try {
      await send({
        event: "oss.runtime.instance_created",
        telemetryId: blankTelemetryId,
      });

      expect(readRequest().headers[TELEMETRY_ID_HEADER]).toBeUndefined();
    } finally {
      teardown();
    }
  },
);

test.each([
  "bad\nid",
  "bad\rid",
  "bad\u0000id",
  "bad\u0001id",
  "bad\u007fid",
  "tenant-🚀",
])(
  "header-invalid standalone identity %j sends anonymously instead of dropping the event",
  async (invalidTelemetryId) => {
    const { readRequest, teardown } = setupCapturedRequest();

    try {
      await send({
        event: "oss.runtime.instance_created",
        telemetryId: invalidTelemetryId,
      });

      const { headers, rawTelemetryIdHeader } = readRequest();
      expect(rawTelemetryIdHeader).toBeUndefined();
      expect(headers[TELEMETRY_ID_HEADER]).toBeUndefined();
    } finally {
      teardown();
    }
  },
);

test("does not treat COPILOTKIT_TELEMETRY_ID as an identity alias", async () => {
  const originalTelemetryId = process.env.COPILOTKIT_TELEMETRY_ID;
  const envTelemetryId = "environment-telemetry-id";
  process.env.COPILOTKIT_TELEMETRY_ID = envTelemetryId;
  const { readRequest, teardown } = setupCapturedRequest();

  try {
    await send({ event: "oss.runtime.instance_created" });

    const { bodyText, headers } = readRequest();
    expect(headers[TELEMETRY_ID_HEADER]).toBeUndefined();
    expect(bodyText).not.toContain(envTelemetryId);
  } finally {
    if (originalTelemetryId === undefined) {
      delete process.env.COPILOTKIT_TELEMETRY_ID;
    } else {
      process.env.COPILOTKIT_TELEMETRY_ID = originalTelemetryId;
    }
    teardown();
  }
});

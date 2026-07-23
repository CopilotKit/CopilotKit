import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { send } from "./lambda-client";

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

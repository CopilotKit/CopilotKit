import { expect, test, vi } from "vitest";
import { lambdaClient } from "@copilotkit/shared";
import { TelemetryClient } from "../telemetry/telemetry-client";
import type { RuntimeInstanceCreatedInfo } from "../telemetry/events";

const instanceCreatedEvent: RuntimeInstanceCreatedInfo = {
  actionsAmount: 0,
  endpointTypes: [],
  endpointsAmount: 0,
  "cloud.api_key_provided": false,
};

/** Build the signature-agnostic legacy token shape used at this boundary. */
function jwtWithTelemetryId(telemetryId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ telemetry_id: telemetryId }),
  ).toString("base64url");
  return `header.${payload}.sig`;
}

/**
 * Creates one isolated V2 telemetry capture.
 *
 * `randomValue` no longer decides anything — this client does not sample.
 * The spy stays so the tests can assert it is never consulted, which is
 * what would break if a gate came back.
 */
function setupRuntimeCapture(
  randomValue: number,
  telemetryId: string = " \t ",
) {
  const priorSampleRate = process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE;
  delete process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE;
  const randomSpy = vi.spyOn(Math, "random").mockReturnValue(randomValue);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const client = new TelemetryClient({ telemetryDisabled: false });
  client.setLicenseToken(jwtWithTelemetryId(telemetryId));

  return {
    client,
    randomSpy,
    teardown: () => {
      randomSpy.mockRestore();
      warnSpy.mockRestore();
      if (priorSampleRate === undefined) {
        delete process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE;
      } else {
        process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE = priorSampleRate;
      }
    },
  };
}

test("V2 whitespace-only legacy claim is rejected as an identity", async () => {
  const sinkSpy = vi.spyOn(lambdaClient, "send").mockResolvedValue(undefined);
  const { client, randomSpy, teardown } = setupRuntimeCapture(0.99);

  try {
    await client.capture("oss.runtime.instance_created", instanceCreatedEvent);

    // The event goes either way. What proves the claim was rejected is
    // that it goes marked anonymous, and with no identity header.
    expect(randomSpy).not.toHaveBeenCalled();
    expect(sinkSpy.mock.calls[0][0].globalProperties).toMatchObject({
      telemetry_identified: false,
    });
  } finally {
    sinkSpy.mockRestore();
    teardown();
  }
});

test("V2 whitespace-only legacy claim sends no identity header", async () => {
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("", { status: 202 }));
  const { client, randomSpy, teardown } = setupRuntimeCapture(0);

  try {
    await client.capture("oss.runtime.instance_created", instanceCreatedEvent);

    expect(randomSpy).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const request = fetchSpy.mock.calls[0]?.[1];
    expect(
      new Headers(request?.headers).get("X-CopilotKit-Telemetry-Id"),
    ).toBeNull();
  } finally {
    fetchSpy.mockRestore();
    teardown();
  }
});

test.each(["bad\nid", "bad\u0000id", "tenant-🚀"])(
  "V2 header-invalid legacy claim %j is rejected as an identity",
  async (invalidTelemetryId) => {
    const sinkSpy = vi.spyOn(lambdaClient, "send").mockResolvedValue(undefined);
    const { client, randomSpy, teardown } = setupRuntimeCapture(
      0.99,
      invalidTelemetryId,
    );

    try {
      await client.capture(
        "oss.runtime.instance_created",
        instanceCreatedEvent,
      );

      expect(randomSpy).not.toHaveBeenCalled();
      expect(sinkSpy.mock.calls[0][0].globalProperties).toMatchObject({
        telemetry_identified: false,
      });
    } finally {
      sinkSpy.mockRestore();
      teardown();
    }
  },
);

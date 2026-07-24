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

/** Builds the signature-agnostic legacy token shape used at this boundary. */
function jwtWithWhitespaceTelemetryId(): string {
  const payload = Buffer.from(
    JSON.stringify({ telemetry_id: " \t " }),
  ).toString("base64url");
  return `header.${payload}.sig`;
}

/** Creates one isolated V2 telemetry capture with a fixed sampling decision. */
function setupRuntimeCapture(randomValue: number) {
  const priorSampleRate = process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE;
  delete process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE;
  const randomSpy = vi.spyOn(Math, "random").mockReturnValue(randomValue);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const client = new TelemetryClient({
    telemetryDisabled: false,
    sampleRate: 0.05,
  });
  client.setLicenseToken(jwtWithWhitespaceTelemetryId());

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

test("V2 whitespace-only legacy claim stays subject to sampling", async () => {
  const sinkSpy = vi.spyOn(lambdaClient, "send").mockResolvedValue(undefined);
  const { client, randomSpy, teardown } = setupRuntimeCapture(0.99);

  try {
    await client.capture("oss.runtime.instance_created", instanceCreatedEvent);

    expect(randomSpy).toHaveBeenCalledTimes(1);
    expect(sinkSpy).not.toHaveBeenCalled();
  } finally {
    sinkSpy.mockRestore();
    teardown();
  }
});

test("V2 sampled whitespace-only legacy claim sends no identity header", async () => {
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("", { status: 202 }));
  const { client, randomSpy, teardown } = setupRuntimeCapture(0);

  try {
    await client.capture("oss.runtime.instance_created", instanceCreatedEvent);

    expect(randomSpy).toHaveBeenCalledTimes(1);
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

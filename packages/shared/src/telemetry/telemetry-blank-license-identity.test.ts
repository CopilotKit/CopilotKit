import { expect, test, vi } from "vitest";
import { lambdaClient } from "./lambda-client";
import { TelemetryClient } from "./telemetry-client";

const { segmentTrackMock } = vi.hoisted(() => ({
  segmentTrackMock: vi.fn(),
}));

vi.mock("@segment/analytics-node", () => ({
  Analytics: class {
    track = segmentTrackMock;
  },
}));

const instanceCreatedEvent = {
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

/** Creates one isolated Shared telemetry capture with a fixed sampling decision. */
function setupSharedCapture(randomValue: number, telemetryId: string = " \t ") {
  const priorSampleRate = process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE;
  delete process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE;
  segmentTrackMock.mockReset();
  const randomSpy = vi.spyOn(Math, "random").mockReturnValue(randomValue);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const client = new TelemetryClient({
    packageName: "@copilotkit/shared",
    packageVersion: "test",
    telemetryDisabled: false,
    sampleRate: 0.05,
  });
  client.setLicenseToken(jwtWithTelemetryId(telemetryId));

  return {
    client,
    randomSpy,
    teardown: () => {
      randomSpy.mockRestore();
      warnSpy.mockRestore();
      segmentTrackMock.mockReset();
      if (priorSampleRate === undefined) {
        delete process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE;
      } else {
        process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE = priorSampleRate;
      }
    },
  };
}

test("Shared whitespace-only legacy claim stays subject to sampling", async () => {
  const sinkSpy = vi.spyOn(lambdaClient, "send").mockResolvedValue(undefined);
  const { client, randomSpy, teardown } = setupSharedCapture(0.99);

  try {
    await client.capture("oss.runtime.instance_created", instanceCreatedEvent);

    expect(randomSpy).toHaveBeenCalledTimes(1);
    expect(sinkSpy).not.toHaveBeenCalled();
    expect(segmentTrackMock).not.toHaveBeenCalled();
  } finally {
    sinkSpy.mockRestore();
    teardown();
  }
});

test("Shared sampled whitespace-only legacy claim sends no identity header", async () => {
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("", { status: 202 }));
  const { client, randomSpy, teardown } = setupSharedCapture(0);

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

test.each(["bad\nid", "bad\u0000id", "tenant-🚀"])(
  "Shared header-invalid legacy claim %j stays subject to sampling",
  async (invalidTelemetryId) => {
    const sinkSpy = vi.spyOn(lambdaClient, "send").mockResolvedValue(undefined);
    const { client, randomSpy, teardown } = setupSharedCapture(
      0.99,
      invalidTelemetryId,
    );

    try {
      await client.capture(
        "oss.runtime.instance_created",
        instanceCreatedEvent,
      );

      expect(randomSpy).toHaveBeenCalledTimes(1);
      expect(sinkSpy).not.toHaveBeenCalled();
      expect(segmentTrackMock).not.toHaveBeenCalled();
    } finally {
      sinkSpy.mockRestore();
      teardown();
    }
  },
);

import { expect, test, vi } from "vitest";
import { lambdaClient } from "@copilotkit/shared";
import { TelemetryClient } from "../telemetry/telemetry-client";
import type { TelemetryIdentity } from "../telemetry/telemetry-client";
import type { RuntimeInstanceCreatedInfo } from "../telemetry/events";

const instanceCreatedEvent: RuntimeInstanceCreatedInfo = {
  actionsAmount: 0,
  endpointTypes: [],
  endpointsAmount: 0,
  "cloud.api_key_provided": false,
};

/** Builds the signature-agnostic legacy token shape used at this boundary. */
function jwtWithTelemetryId(telemetryId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ telemetry_id: telemetryId }),
  ).toString("base64url");
  return `header.${payload}.sig`;
}

/**
 * Creates one isolated V2 telemetry capture.
 *
 * The Math.random spy stays even though this client no longer samples: a
 * dice roll reappearing here is exactly the regression these tests exist
 * to catch, and `expect(random).not.toHaveBeenCalled()` only means
 * something while the spy is installed.
 */
function setupRuntimeCapture(identity: TelemetryIdentity, randomValue: number) {
  const priorSampleRate = process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE;
  delete process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE;
  const random = vi.spyOn(Math, "random").mockReturnValue(randomValue);
  const send = vi.spyOn(lambdaClient, "send").mockResolvedValue(undefined);
  const client = new TelemetryClient({ telemetryDisabled: false });
  client.setTelemetryIdentity(identity);

  return {
    client,
    random,
    send,
    teardown: () => {
      send.mockRestore();
      random.mockRestore();
      if (priorSampleRate === undefined) {
        delete process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE;
      } else {
        process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE = priorSampleRate;
      }
    },
  };
}

test.each([
  {
    label: "anonymous",
    identity: {},
    expectedTransportIdentity: {
      licenseToken: undefined,
      telemetryId: undefined,
    },
  },
  {
    label: "standalone-identified",
    identity: { telemetryId: "standalone-id" },
    expectedTransportIdentity: {
      licenseToken: undefined,
      telemetryId: "standalone-id",
    },
  },
] satisfies readonly {
  label: string;
  identity: TelemetryIdentity;
  expectedTransportIdentity: {
    licenseToken: string | undefined;
    telemetryId: string | undefined;
  };
}[])(
  "V2 $label send is unsampled and says so in its metadata",
  async ({ identity, expectedTransportIdentity }) => {
    // Math.random is pinned to 0.99, which under the old 0.05 gate would
    // have dropped this event outright.
    const { client, random, send, teardown } = setupRuntimeCapture(
      identity,
      0.99,
    );

    try {
      await client.capture(
        "oss.runtime.instance_created",
        instanceCreatedEvent,
      );

      expect(random).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]?.[0]).toMatchObject({
        ...expectedTransportIdentity,
      });
      expect(send.mock.calls[0]?.[0].properties).toEqual(instanceCreatedEvent);
      expect(send.mock.calls[0]?.[0].globalProperties).toEqual({
        sampleRate: 1,
        sampleRateAdjustmentFactor: 0,
        sampleWeight: 1,
        telemetry_emitter: "v2-runtime",
        telemetry_surface: "v2",
        telemetry_identified: false,
        telemetry_transport: "lambda",
      });
    } finally {
      teardown();
    }
  },
);

test("COPILOTKIT_TELEMETRY_SAMPLE_RATE no longer gates the V2 client", async () => {
  // The knob was removed here rather than left as dead configuration. A
  // rate of 0 used to silence this client completely; the documented
  // opt-out is COPILOTKIT_TELEMETRY_DISABLED.
  process.env.COPILOTKIT_TELEMETRY_SAMPLE_RATE = "0";
  const { client, random, send, teardown } = setupRuntimeCapture({}, 0.99);

  try {
    await client.capture("oss.runtime.instance_created", instanceCreatedEvent);

    expect(random).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    teardown();
  }
});

test("V2 legacy-authorized send is marked identified", async () => {
  const licenseToken = jwtWithTelemetryId("legacy-license-id");
  const { client, random, send, teardown } = setupRuntimeCapture(
    { licenseToken },
    0.99,
  );

  try {
    await client.capture("oss.runtime.instance_created", instanceCreatedEvent);

    expect(random).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      licenseToken,
      telemetryId: undefined,
    });
    expect(send.mock.calls[0]?.[0].properties).toEqual(instanceCreatedEvent);
    expect(send.mock.calls[0]?.[0].globalProperties).toEqual({
      sampleRate: 1,
      sampleRateAdjustmentFactor: 0,
      sampleWeight: 1,
      telemetry_emitter: "v2-runtime",
      telemetry_surface: "v2",
      telemetry_identified: true,
      telemetry_transport: "lambda",
    });
  } finally {
    teardown();
  }
});

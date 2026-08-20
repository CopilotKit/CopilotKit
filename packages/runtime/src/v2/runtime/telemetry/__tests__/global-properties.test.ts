import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { lambdaClient } from "@copilotkit/shared";
import { TelemetryClient } from "../telemetry-client";

/**
 * Properties that describe the caller rather than the call.
 *
 * A product built on this runtime needs to be tellable apart in the events that
 * already go, and the alternative to one carried field is a second set of
 * events describing the same runs.
 *
 * Asserted at the send boundary rather than on the instance, because a field
 * held correctly and dropped on the way out is the failure that matters.
 */
describe("telemetry global properties", () => {
  let send: ReturnType<typeof vi.spyOn>;

  function client() {
    // Sample rate 1 so nothing is dropped by the anonymous gate; these assert
    // what a sent event carries, not whether it was sampled.
    return new TelemetryClient({ sampleRate: 1 });
  }

  beforeEach(() => {
    send = vi.spyOn(lambdaClient, "send").mockResolvedValue(undefined as never);
  });

  /**
   * The properties the one sent event carried.
   *
   * Asserted through a helper rather than by indexing the mock inline, so a
   * missing call fails as a missing call rather than as a property read on
   * undefined two lines later.
   */
  function sentProperties(): Record<string, unknown> {
    expect(send).toHaveBeenCalledTimes(1);
    const [payload] = send.mock.calls[0] as [
      { properties: Record<string, unknown> },
    ];
    return payload.properties;
  }

  afterEach(() => {
    send.mockRestore();
  });

  it("carries them on an event that sets none of its own", async () => {
    const telemetry = client();
    telemetry.setGlobalProperties({ accessibility_title: "OpenBot" });

    await telemetry.capture("oss.runtime.agent_execution_stream_started", {});

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      event: "oss.runtime.agent_execution_stream_started",
      properties: { accessibility_title: "OpenBot" },
    });
  });

  it("carries them alongside an event's own properties", async () => {
    const telemetry = client();
    telemetry.setGlobalProperties({ accessibility_title: "OpenBot" });

    await telemetry.capture("oss.runtime.instance_created", {
      actionsAmount: 0,
      endpointTypes: [],
      endpointsAmount: 0,
      agentsAmount: 3,
      "cloud.api_key_provided": false,
    });

    expect(send.mock.calls[0]?.[0]).toMatchObject({
      properties: { accessibility_title: "OpenBot", agentsAmount: 3 },
    });
  });

  it("merges successive calls rather than replacing", async () => {
    const telemetry = client();
    telemetry.setGlobalProperties({ accessibility_title: "OpenBot" });
    telemetry.setGlobalProperties({ deployment_shape: "self-hosted" });

    await telemetry.capture("oss.runtime.agent_execution_stream_ended", {});

    expect(send.mock.calls[0]?.[0]).toMatchObject({
      properties: {
        accessibility_title: "OpenBot",
        deployment_shape: "self-hosted",
      },
    });
  });

  /*
   * The specific beats the general. A caller describing one event knows more
   * than a value set once at construction, so a global must not overwrite it.
   */
  it("lets an event's own property win on conflict", async () => {
    const telemetry = client();
    telemetry.setGlobalProperties({ agentsAmount: 99 });

    await telemetry.capture("oss.runtime.instance_created", {
      actionsAmount: 0,
      endpointTypes: [],
      endpointsAmount: 0,
      agentsAmount: 3,
      "cloud.api_key_provided": false,
    });

    expect(sentProperties().agentsAmount).toBe(3);
  });

  it("sends nothing at all when telemetry is disabled", async () => {
    const telemetry = new TelemetryClient({
      telemetryDisabled: true,
      sampleRate: 1,
    });
    telemetry.setGlobalProperties({ accessibility_title: "OpenBot" });

    await telemetry.capture("oss.runtime.agent_execution_stream_started", {});

    expect(send).not.toHaveBeenCalled();
  });

  it("adds nothing when none are set", async () => {
    await client().capture("oss.runtime.agent_execution_stream_started", {});

    expect(sentProperties()).toEqual({});
  });
});

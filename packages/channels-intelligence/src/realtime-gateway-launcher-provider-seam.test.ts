import { createChannel } from "@copilotkit/channels-core";
import { describe, expect, it } from "vitest";
import { DeliveryTestGateway } from "./delivery-test-gateway.js";
import { startChannelsWithGatewayControl } from "./realtime-gateway-launcher.js";

/**
 * `startChannelsWithGatewayControl` is exported so a caller can compose over a
 * Realtime Gateway session it owns itself. That makes the provider seam a PUBLIC
 * contract, not an internal detail of the socket-owning wrapper: a handle
 * returned without `providerStates` makes `ChannelManager` fall back to
 * `unknown`, which keeps the transport-derived status and so reports `online`
 * for a Channel with no Slack/Teams app bound — the precise false green OSS-739
 * removes, reached through a public export rather than the default path.
 */
async function startOverSession(
  session: DeliveryTestGateway,
  runtimeInstanceId: string,
) {
  const channel = createChannel({ identifyUser: "platform", name: "support" });
  channel.onMessage(() => undefined);
  return startChannelsWithGatewayControl([channel], {
    session,
    scope: { projectId: 1, channelName: "support" },
    runtimeInstanceId,
    runCanonical: async (args) => args.execute({}),
    loadHistory: async () => [],
  });
}

/** A session that exposes the provider seam, with a test-flippable value. */
class ProviderStateGateway extends DeliveryTestGateway {
  states: Record<string, string> | undefined = { support: "not_attached" };
  /** Reads `this`, so a detached reference would throw rather than answer. */
  providerStates(): Readonly<Record<string, string>> | undefined {
    return this.states;
  }
}

describe("startChannelsWithGatewayControl provider seam", () => {
  it("forwards providerStates off a session that exposes it", async () => {
    const gateway = new ProviderStateGateway();
    const handle = await startOverSession(gateway, "rti_seam_forward");

    try {
      // Without the forward this is `undefined` and the manager reports `online`
      // for an unprovisioned Channel.
      expect(handle.providerStates?.()).toEqual({ support: "not_attached" });
    } finally {
      await handle.stop();
    }
  });

  it("forwards as a getter, so a value that changes after start is observed", async () => {
    const gateway = new ProviderStateGateway();
    const handle = await startOverSession(gateway, "rti_seam_getter");

    try {
      expect(handle.providerStates?.()).toEqual({ support: "not_attached" });

      // The Channel is provisioned while the runtime is already running (or a
      // Phoenix auto-rejoin refreshed the control reply). A snapshot captured at
      // start would still say `not_attached` forever.
      gateway.states = { support: "attached" };
      expect(handle.providerStates?.()).toEqual({ support: "attached" });
    } finally {
      await handle.stop();
    }
  });

  it("calls the seam ON the session, so a class-based session reading `this` works", async () => {
    const gateway = new ProviderStateGateway();
    const handle = await startOverSession(gateway, "rti_seam_this");

    try {
      // `ProviderStateGateway.providerStates` reads `this.states`; a detached
      // reference (`const f = session.providerStates; f()`) would throw here.
      expect(() => handle.providerStates?.()).not.toThrow();
      expect(handle.providerStates?.()).toEqual({ support: "not_attached" });
    } finally {
      await handle.stop();
    }
  });

  it("omits providerStates for a session without the seam", async () => {
    const gateway = new DeliveryTestGateway();
    const handle = await startOverSession(gateway, "rti_seam_absent");

    try {
      // Absent rather than a stub returning `undefined`: the manager treats both
      // as `unknown`, but the handle must not advertise a seam it cannot serve.
      expect(handle.providerStates).toBeUndefined();
    } finally {
      await handle.stop();
    }
  });
});

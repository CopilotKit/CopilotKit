import { describe, it, expect, vi } from "vitest";
import { createChannel } from "@copilotkit/channels";
import { CopilotKitIntelligence } from "../../intelligence-platform";
import { ChannelManager, foldChannelLegs } from "../channel-manager";
import type {
  ActivateChannelEngine,
  ChannelsHandle,
  ChannelProviderLeg,
} from "../channel-manager";

/** A CopilotKitIntelligence whose runner API key carries a parseable project id. */
function fakeIntelligence(): CopilotKitIntelligence {
  return new CopilotKitIntelligence({
    apiUrl: "https://runtime.example",
    wsUrl: "wss://runtime.example",
    apiKey: "cpk-42_short_long",
  });
}

/**
 * A handle that reports provider states, as the gateway launcher's handle does.
 *
 * `states` is read through a callback so a test can change what the gateway
 * "reports" between `status()` calls — the real handle delegates to a getter for
 * exactly that reason (a rejoin refreshes the reply).
 */
function handleReporting(
  states: () => Record<string, string> | undefined,
): ChannelsHandle {
  return {
    metadata: {},
    stop: vi.fn(async () => {}),
    providerStates: () => states(),
  };
}

/** A handle with no provider-state seam at all (a non-gateway/test handle). */
function handleWithoutSeam(): ChannelsHandle {
  return { metadata: {}, stop: vi.fn(async () => {}) };
}

async function managerWith(handle: ChannelsHandle, names = ["support"]) {
  const channels = names.map((name) =>
    createChannel({ identifyUser: "platform", name }),
  );
  const engine: ActivateChannelEngine = vi.fn(async () => handle);
  const mgr = new ChannelManager({
    intelligence: fakeIntelligence(),
    channels,
    activateChannel: engine,
  });
  mgr.activate();
  await mgr.ready();
  return mgr;
}

describe("foldChannelLegs", () => {
  it("lets a non-online transport dominate whatever the provider said", () => {
    // A Channel mid-reconnect must read as an outage, not as a setup problem.
    for (const transport of [
      "connecting",
      "reconnecting",
      "stopped",
      "error",
    ] as const) {
      expect(foldChannelLegs(transport, "not_attached")).toBe(transport);
      expect(foldChannelLegs(transport, "attached")).toBe(transport);
    }
  });

  it("maps each provider state once the transport is online", () => {
    const cases: [ChannelProviderLeg, string][] = [
      ["attached", "online"],
      ["unknown", "online"],
      ["unhealthy", "error"],
      ["not_attached", "setup_required"],
      ["disabled", "setup_required"],
      ["channel_not_declared", "setup_required"],
    ];
    for (const [provider, expected] of cases) {
      expect(foldChannelLegs("online", provider)).toBe(expected);
    }
  });
});

describe("ChannelManager provider leg", () => {
  it("reports setup_required for a joined Channel with no provider attached", async () => {
    // THE regression test this contract exists for. Before the legs were split,
    // a Channel with no Slack app created at all reported `online`, and every
    // version of our onboarding guidance used `overall === "online"` as gate 2 to
    // certify end-to-end success.
    const mgr = await managerWith(
      handleReporting(() => ({ support: "not_attached" })),
    );

    const status = mgr.status();

    expect(status.overall).toBe("setup_required");
    expect(status.channels.support).toBe("setup_required");
    expect(status.detail.support).toEqual({
      status: "setup_required",
      transport: "online",
      provider: "not_attached",
    });
  });

  it("separates the two legs so a caller can assert the one it cares about", async () => {
    const mgr = await managerWith(
      handleReporting(() => ({ support: "not_attached" })),
    );

    // The socket really is up; only the provider binding is missing. A caller
    // debugging connectivity must be able to see that distinction.
    expect(mgr.status().detail.support.transport).toBe("online");
    expect(mgr.status().detail.support.provider).toBe("not_attached");
  });

  it("reports online when a provider is attached", async () => {
    const mgr = await managerWith(
      handleReporting(() => ({ support: "attached" })),
    );

    const status = mgr.status();

    expect(status.overall).toBe("online");
    expect(status.detail.support).toEqual({
      status: "online",
      transport: "online",
      provider: "attached",
    });
  });

  it("treats a configured-but-unhealthy provider as an error", async () => {
    const mgr = await managerWith(
      handleReporting(() => ({ support: "unhealthy" })),
    );

    expect(mgr.status().overall).toBe("error");
    expect(mgr.status().detail.support.provider).toBe("unhealthy");
  });

  it("re-reads provider state on each call, so a rejoin picks up new provisioning", async () => {
    let reported = "not_attached";
    const mgr = await managerWith(
      handleReporting(() => ({
        support: reported,
      })),
    );

    expect(mgr.status().overall).toBe("setup_required");

    // The gateway's join hooks re-fire on auto-rejoin, so the newest reply wins
    // without the manager re-activating anything.
    reported = "attached";

    expect(mgr.status().overall).toBe("online");
  });

  describe("degrades to transport-only status rather than claiming no provider", () => {
    it("when the handle has no provider-state seam (older gateway package)", async () => {
      const mgr = await managerWith(handleWithoutSeam());

      expect(mgr.status().overall).toBe("online");
      expect(mgr.status().detail.support.provider).toBe("unknown");
    });

    it("when the gateway reported nothing (older gateway or failed lookup)", async () => {
      const mgr = await managerWith(handleReporting(() => undefined));

      expect(mgr.status().overall).toBe("online");
      expect(mgr.status().detail.support.provider).toBe("unknown");
    });

    it("when the gateway did not mention this Channel", async () => {
      const mgr = await managerWith(
        handleReporting(() => ({ somethingElse: "not_attached" })),
      );

      expect(mgr.status().overall).toBe("online");
      expect(mgr.status().detail.support.provider).toBe("unknown");
    });

    it("when the gateway sent an unrecognised state", async () => {
      const mgr = await managerWith(
        handleReporting(() => ({ support: "brand_new_state" })),
      );

      expect(mgr.status().overall).toBe("online");
      expect(mgr.status().detail.support.provider).toBe("unknown");
    });

    it("when the getter throws", async () => {
      const mgr = await managerWith(
        handleReporting(() => {
          throw new Error("handle exploded");
        }),
      );

      // A misbehaving handle must never break a status snapshot.
      expect(() => mgr.status()).not.toThrow();
      expect(mgr.status().overall).toBe("online");
      expect(mgr.status().detail.support.provider).toBe("unknown");
    });
  });

  it("folds the worst Channel into overall while keeping each Channel's legs", async () => {
    const mgr = await managerWith(
      handleReporting(() => ({
        support: "attached",
        sales: "not_attached",
      })),
      ["support", "sales"],
    );

    const status = mgr.status();

    expect(status.overall).toBe("setup_required");
    expect(status.channels).toEqual({
      support: "online",
      sales: "setup_required",
    });
    expect(status.detail.support.provider).toBe("attached");
    expect(status.detail.sales.provider).toBe("not_attached");
  });

  it("keeps detail present and consistent after stop()", async () => {
    const mgr = await managerWith(
      handleReporting(() => ({ support: "attached" })),
    );

    await mgr.stop();
    const status = mgr.status();

    expect(status.overall).toBe("stopped");
    expect(status.detail.support.status).toBe("stopped");
    expect(status.detail.support.transport).toBe("stopped");
  });
});

import { describe, it, expect, vi } from "vitest";
import { createChannel, FakeAgent } from "@copilotkit/channels-core";
import { Section } from "@copilotkit/channels-ui";
import {
  InMemoryDeliverySource,
  InMemoryEgressSink,
  InMemoryRenderEventSink,
} from "./in-memory-transports.js";
import {
  assertValidChannelNames,
  buildChannelActivationMetadata,
  resolveChannelActivationEnv,
  startChannels,
} from "./runtime.js";

describe("assertValidChannelNames", () => {
  it("throws when a bot has no name", () => {
    const bot = createChannel({ agent: () => new FakeAgent() });
    expect(() => assertValidChannelNames([bot])).toThrow(/name/i);
  });

  it("throws on a non-channel name", () => {
    const bot = createChannel({
      name: "Bad Name!",
      agent: () => new FakeAgent(),
    });
    expect(() => assertValidChannelNames([bot])).toThrow(
      /channel name|invalid/i,
    );
  });

  it("throws on duplicate names", () => {
    const a = createChannel({ name: "support", agent: () => new FakeAgent() });
    const b = createChannel({ name: "support", agent: () => new FakeAgent() });
    expect(() => assertValidChannelNames([a, b])).toThrow(/duplicate/i);
  });

  it("rejects uppercase channel names", () => {
    const bot = createChannel({
      name: "Support",
      agent: () => new FakeAgent(),
    });
    expect(() => assertValidChannelNames([bot])).toThrow(
      /lowercase kebab-case/i,
    );
  });

  it("rejects the reserved channels name", () => {
    const bot = createChannel({
      name: "channels",
      agent: () => new FakeAgent(),
    });
    expect(() => assertValidChannelNames([bot])).toThrow(/reserved/i);
  });

  it("accepts valid unique channel names", () => {
    const a = createChannel({
      name: "support-bot",
      agent: () => new FakeAgent(),
    });
    const b = createChannel({ name: "triage-2", agent: () => new FakeAgent() });
    expect(() => assertValidChannelNames([a, b])).not.toThrow();
  });
});

describe("buildChannelActivationMetadata", () => {
  it("includes declared channel names and the provided env", () => {
    const a = createChannel({ name: "support", agent: () => new FakeAgent() });
    const b = createChannel({ name: "triage", agent: () => new FakeAgent() });
    const meta = buildChannelActivationMetadata([a, b], {
      runtimeEnv: "production",
      nodeVersion: "v20",
      runtimePackageVersion: "1.2.3",
    });
    expect(meta.declaredChannelNames).toEqual(["support", "triage"]);
    expect(meta.runtimeEnv).toBe("production");
    expect(meta.nodeVersion).toBe("v20");
    expect(meta.runtimePackageVersion).toBe("1.2.3");
  });

  it("includes each channel's declared command names", () => {
    const a = createChannel({ name: "support", agent: () => new FakeAgent() });
    a.onCommand("triage", async () => {});
    const meta = buildChannelActivationMetadata([a], { runtimeEnv: "test" });
    expect(meta.declaredChannels).toEqual([
      { channelName: "support", commands: ["triage"] },
    ]);
  });
});

describe("resolveChannelActivationEnv", () => {
  it("prefers COPILOTKIT_RUNTIME_ENV, includes the node version, and lets overrides win", () => {
    const prev = process.env.COPILOTKIT_RUNTIME_ENV;
    process.env.COPILOTKIT_RUNTIME_ENV = "staging";
    try {
      const env = resolveChannelActivationEnv({
        runtimePackageVersion: "9.9.9",
        runtimeInstanceId: "inst-1",
      });
      expect(env.runtimeEnv).toBe("staging");
      expect(env.nodeVersion).toBe(process.version);
      expect(env.runtimePackageVersion).toBe("9.9.9");
      expect(env.runtimeInstanceId).toBe("inst-1");
    } finally {
      if (prev === undefined) delete process.env.COPILOTKIT_RUNTIME_ENV;
      else process.env.COPILOTKIT_RUNTIME_ENV = prev;
    }
  });

  it("falls back to NODE_ENV, then 'development'", () => {
    const prev = process.env.COPILOTKIT_RUNTIME_ENV;
    delete process.env.COPILOTKIT_RUNTIME_ENV;
    try {
      expect(resolveChannelActivationEnv().runtimeEnv).toBe(
        process.env.NODE_ENV ?? "development",
      );
    } finally {
      if (prev !== undefined) process.env.COPILOTKIT_RUNTIME_ENV = prev;
    }
  });
});

describe("startChannels", () => {
  it("validates, wires each Channel with a channel adapter, and routes delivery per channel", async () => {
    const a = createChannel({ name: "support", agent: () => new FakeAgent() });
    const b = createChannel({ name: "triage", agent: () => new FakeAgent() });
    const aPosted: string[] = [];
    const bPosted: string[] = [];
    a.onMessage(async ({ thread }) => {
      aPosted.push("a");
      await thread.post(Section({ children: "A" }));
    });
    b.onMessage(async ({ thread }) => {
      bPosted.push("b");
      await thread.post(Section({ children: "B" }));
    });

    const sources = new Map<string, InMemoryDeliverySource>();
    const sinks = new Map<string, InMemoryEgressSink>();
    const handle = await startChannels({
      channels: [a, b],
      resolveTransport: (channelName) => {
        const source = new InMemoryDeliverySource();
        const egress = new InMemoryEgressSink();
        sources.set(channelName, source);
        sinks.set(channelName, egress);
        return { source, egress };
      },
      env: { runtimeEnv: "test" },
    });

    expect([...handle.metadata.declaredChannelNames].sort()).toEqual([
      "support",
      "triage",
    ]);

    await sources.get("support")!.deliver({
      deliveryId: "d1",
      eventId: "e1",
      turnId: "t1",
      channelName: "support",
      platform: "slack",
      conversationKey: "c1",
      route: {},
      kind: "turn",
      text: "hi",
    });

    expect(aPosted).toEqual(["a"]);
    expect(bPosted).toEqual([]);
    expect(sinks.get("support")!.ops).toHaveLength(1);

    await handle.stop();
  });

  it("forwards renderSink so channel runtime streams rich render frames", async () => {
    const bot = createChannel({
      name: "support",
      agent: () => new FakeAgent(),
    });
    bot.onMessage(async ({ thread }) => {
      await thread.post(Section({ children: "A" }));
    });

    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const renderSink = new InMemoryRenderEventSink();
    const handle = await startChannels({
      channels: [bot],
      resolveTransport: () => ({ source, egress, renderSink }),
      env: { runtimeEnv: "test" },
    });

    await source.deliver({
      deliveryId: "d1",
      eventId: "e1",
      turnId: "t1",
      channelName: "support",
      platform: "slack",
      conversationKey: "c1",
      route: {},
      kind: "turn",
      text: "hi",
    });

    expect(renderSink.frames.some((f) => f.event.kind === "post")).toBe(true);
    expect(egress.ops).toHaveLength(0);

    await handle.stop();
  });

  it("throws on invalid names before wiring anything", async () => {
    const a = createChannel({ agent: () => new FakeAgent() }); // no name
    await expect(
      startChannels({
        channels: [a],
        resolveTransport: () => ({
          source: new InMemoryDeliverySource(),
          egress: new InMemoryEgressSink(),
        }),
        env: { runtimeEnv: "test" },
      }),
    ).rejects.toThrow(/name/i);
  });

  it("rolls back already-started bots when a later bot fails to start", async () => {
    const a = createChannel({ name: "support", agent: () => new FakeAgent() });
    const b = createChannel({ name: "triage", agent: () => new FakeAgent() });
    const stopA = vi.spyOn(a.ɵruntime, "stop");
    await expect(
      startChannels({
        channels: [a, b],
        // First bot wires fine; second bot's transport resolution throws
        // AFTER `a` is already live.
        resolveTransport: (channelName) => {
          if (channelName === "triage") throw new Error("boom");
          return {
            source: new InMemoryDeliverySource(),
            egress: new InMemoryEgressSink(),
          };
        },
        env: { runtimeEnv: "test" },
      }),
    ).rejects.toThrow(/boom/);
    expect(stopA).toHaveBeenCalledTimes(1);
  });

  it("warns (but does not throw) when called with no bots", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const handle = await startChannels({
        channels: [],
        resolveTransport: () => ({
          source: new InMemoryDeliverySource(),
          egress: new InMemoryEgressSink(),
        }),
        env: { runtimeEnv: "test" },
      });
      expect(handle.metadata.declaredChannelNames).toEqual([]);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/no channels/i));
      await handle.stop();
    } finally {
      warn.mockRestore();
    }
  });
});

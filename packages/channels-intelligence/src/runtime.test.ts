import { describe, it, expect, vi } from "vitest";
import { createBot, FakeAgent } from "@copilotkit/channels";
import { Section } from "@copilotkit/channels-ui";
import {
  InMemoryDeliverySource,
  InMemoryEgressSink,
  InMemoryRenderEventSink,
} from "./in-memory-transports.js";
import {
  assertValidBotNames,
  buildActivationMetadata,
  resolveActivationEnv,
  startManagedBots,
} from "./runtime.js";

describe("assertValidBotNames", () => {
  it("throws when a bot has no name", () => {
    const bot = createBot({ agent: () => new FakeAgent() });
    expect(() => assertValidBotNames([bot])).toThrow(/name/i);
  });

  it("throws on a non-identifier name", () => {
    const bot = createBot({ name: "Bad Name!", agent: () => new FakeAgent() });
    expect(() => assertValidBotNames([bot])).toThrow(/identifier|invalid/i);
  });

  it("throws on duplicate names", () => {
    const a = createBot({ name: "support", agent: () => new FakeAgent() });
    const b = createBot({ name: "support", agent: () => new FakeAgent() });
    expect(() => assertValidBotNames([a, b])).toThrow(/duplicate/i);
  });

  it("treats duplicate names case-insensitively", () => {
    const a = createBot({ name: "Support", agent: () => new FakeAgent() });
    const b = createBot({ name: "support", agent: () => new FakeAgent() });
    expect(() => assertValidBotNames([a, b])).toThrow(/duplicate/i);
  });

  it("accepts valid unique identifier-style names", () => {
    const a = createBot({ name: "support_bot", agent: () => new FakeAgent() });
    const b = createBot({ name: "triage2", agent: () => new FakeAgent() });
    expect(() => assertValidBotNames([a, b])).not.toThrow();
  });
});

describe("buildActivationMetadata", () => {
  it("includes declared bot names and the provided env", () => {
    const a = createBot({ name: "support", agent: () => new FakeAgent() });
    const b = createBot({ name: "triage", agent: () => new FakeAgent() });
    const meta = buildActivationMetadata([a, b], {
      runtimeEnv: "production",
      nodeVersion: "v20",
      runtimePackageVersion: "1.2.3",
    });
    expect(meta.declaredBotNames).toEqual(["support", "triage"]);
    expect(meta.runtimeEnv).toBe("production");
    expect(meta.nodeVersion).toBe("v20");
    expect(meta.runtimePackageVersion).toBe("1.2.3");
  });

  it("includes each bot's declared command names", () => {
    const a = createBot({ name: "support", agent: () => new FakeAgent() });
    a.onCommand("triage", async () => {});
    const meta = buildActivationMetadata([a], { runtimeEnv: "test" });
    expect(meta.declaredBots).toEqual([
      { name: "support", commands: ["triage"] },
    ]);
  });
});

describe("resolveActivationEnv", () => {
  it("prefers COPILOTKIT_RUNTIME_ENV, includes the node version, and lets overrides win", () => {
    const prev = process.env.COPILOTKIT_RUNTIME_ENV;
    process.env.COPILOTKIT_RUNTIME_ENV = "staging";
    try {
      const env = resolveActivationEnv({
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
      expect(resolveActivationEnv().runtimeEnv).toBe(
        process.env.NODE_ENV ?? "development",
      );
    } finally {
      if (prev !== undefined) process.env.COPILOTKIT_RUNTIME_ENV = prev;
    }
  });
});

describe("startManagedBots", () => {
  it("validates, wires each bot with a managed adapter, and routes delivery per bot", async () => {
    const a = createBot({ name: "support", agent: () => new FakeAgent() });
    const b = createBot({ name: "triage", agent: () => new FakeAgent() });
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
    const handle = await startManagedBots({
      bots: [a, b],
      resolveTransport: (botName) => {
        const source = new InMemoryDeliverySource();
        const egress = new InMemoryEgressSink();
        sources.set(botName, source);
        sinks.set(botName, egress);
        return { source, egress };
      },
      env: { runtimeEnv: "test" },
    });

    expect([...handle.metadata.declaredBotNames].sort()).toEqual([
      "support",
      "triage",
    ]);

    await sources.get("support")!.deliver({
      deliveryId: "d1",
      eventId: "e1",
      turnId: "t1",
      botName: "support",
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

  it("forwards renderSink so managed runtime streams rich render frames", async () => {
    const bot = createBot({ name: "support", agent: () => new FakeAgent() });
    bot.onMessage(async ({ thread }) => {
      await thread.post(Section({ children: "A" }));
    });

    const source = new InMemoryDeliverySource();
    const egress = new InMemoryEgressSink();
    const renderSink = new InMemoryRenderEventSink();
    const handle = await startManagedBots({
      bots: [bot],
      resolveTransport: () => ({ source, egress, renderSink }),
      env: { runtimeEnv: "test" },
    });

    await source.deliver({
      deliveryId: "d1",
      eventId: "e1",
      turnId: "t1",
      botName: "support",
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
    const a = createBot({ agent: () => new FakeAgent() }); // no name
    await expect(
      startManagedBots({
        bots: [a],
        resolveTransport: () => ({
          source: new InMemoryDeliverySource(),
          egress: new InMemoryEgressSink(),
        }),
        env: { runtimeEnv: "test" },
      }),
    ).rejects.toThrow(/name/i);
  });

  it("rolls back already-started bots when a later bot fails to start", async () => {
    const a = createBot({ name: "support", agent: () => new FakeAgent() });
    const b = createBot({ name: "triage", agent: () => new FakeAgent() });
    const stopA = vi.spyOn(a, "stop");
    await expect(
      startManagedBots({
        bots: [a, b],
        // First bot wires fine; second bot's transport resolution throws
        // AFTER `a` is already live.
        resolveTransport: (botName) => {
          if (botName === "triage") throw new Error("boom");
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
      const handle = await startManagedBots({
        bots: [],
        resolveTransport: () => ({
          source: new InMemoryDeliverySource(),
          egress: new InMemoryEgressSink(),
        }),
        env: { runtimeEnv: "test" },
      });
      expect(handle.metadata.declaredBotNames).toEqual([]);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/no bots/i));
      await handle.stop();
    } finally {
      warn.mockRestore();
    }
  });
});

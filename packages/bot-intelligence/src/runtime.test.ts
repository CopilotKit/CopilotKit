import { describe, it, expect } from "vitest";
import { createBot, FakeAgent } from "@copilotkit/bot";
import { Section } from "@copilotkit/bot-ui";
import {
  InMemoryDeliverySource,
  InMemoryEgressSink,
} from "./in-memory-transports.js";
import {
  assertValidBotNames,
  buildActivationMetadata,
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
});

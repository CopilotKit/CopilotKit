import { describe, it, expect } from "vitest";
import { createChannel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Track how many times the inline agent was actually run. */
function countingAgent() {
  const agent = new FakeAgent();
  let runs = 0;
  const orig = agent.runAgent.bind(agent);
  agent.runAgent = ((...args: Parameters<typeof orig>) => {
    runs++;
    return orig(...args);
  }) as typeof agent.runAgent;
  return { agent, runs: () => runs };
}

/**
 * The product-driven response policy (plan §2) is applied in `onTurn` when the
 * adapter supplies a normalized `conversationKind` (declarative adapters). When
 * it is omitted the legacy dispatch is preserved so non-declarative adapters are
 * unaffected.
 */
describe("createChannel onTurn — response policy (declarative adapter)", () => {
  it("ignores an untagged shared-channel message with no handlers", async () => {
    const fake = new FakeAdapter();
    const { agent, runs } = countingAgent();
    const channel = createChannel({ adapters: [fake], agent });
    await channel.start();

    fake.emitTurn({
      userText: "chatter",
      conversationKey: "c1",
      conversationKind: "channel",
      mentioned: false,
    });
    await tick();

    expect(runs()).toBe(0);
    expect(fake.posted.length).toBe(0);
  });

  it("auto-runs the agent for an addressed DM with no handlers", async () => {
    const fake = new FakeAdapter();
    const { agent, runs } = countingAgent();
    const channel = createChannel({ adapters: [fake], agent });
    await channel.start();

    fake.emitTurn({
      userText: "help",
      conversationKey: "c1",
      conversationKind: "direct_message",
    });
    await tick();

    expect(runs()).toBe(1);
  });

  it("auto-runs when a shared message explicitly mentions the bot", async () => {
    const fake = new FakeAdapter();
    const { agent, runs } = countingAgent();
    const channel = createChannel({ adapters: [fake], agent });
    await channel.start();

    fake.emitTurn({
      userText: "@bot help",
      conversationKey: "c1",
      conversationKind: "channel",
      mentioned: true,
    });
    await tick();

    expect(runs()).toBe(1);
  });

  it("runs a matching onMention handler instead of auto-running", async () => {
    const fake = new FakeAdapter();
    const { agent, runs } = countingAgent();
    const channel = createChannel({ adapters: [fake], agent });
    let handled = 0;
    channel.onMention(() => {
      handled++;
    });
    await channel.start();

    fake.emitTurn({
      userText: "@bot",
      conversationKey: "c1",
      conversationKind: "channel",
      mentioned: true,
    });
    await tick();

    expect(handled).toBe(1);
    expect(runs()).toBe(0);
  });

  it("lets an onMessage handler opt into an untagged shared message", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake], agent: new FakeAgent() });
    let handled = 0;
    channel.onMessage(() => {
      handled++;
    });
    await channel.start();

    fake.emitTurn({
      userText: "chatter",
      conversationKey: "c1",
      conversationKind: "channel",
      mentioned: false,
    });
    await tick();

    expect(handled).toBe(1);
  });
});

describe("createChannel onTurn — legacy dispatch (no conversationKind)", () => {
  it("still runs a mention handler when the adapter omits conversationKind", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake], agent: new FakeAgent() });
    let handled = 0;
    channel.onMention(() => {
      handled++;
    });
    await channel.start();

    // No conversationKind → legacy behavior preserved (handler fires).
    fake.emitTurn({ userText: "yo", conversationKey: "c1" });
    await tick();

    expect(handled).toBe(1);
  });
});

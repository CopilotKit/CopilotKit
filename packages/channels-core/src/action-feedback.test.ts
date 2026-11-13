import { describe, it, expect, vi, afterEach } from "vitest";
import { createChannel } from "./create-channel.js";
import type { Channel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";
import { Actions, Button } from "@copilotkit/channels-ui";
import type { ChannelNode, ProviderActor } from "@copilotkit/channels-ui";

/**
 * A refused or expired interaction is logged at warn with the action id, a
 * reference to the conversation that does not reveal its key, and the reason.
 * Where the platform has native ephemeral messages, the person who clicked is
 * told why nothing happened.
 */

const tick = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

const alice: ProviderActor = { id: "U_ALICE", kind: "human" };
const mallory: ProviderActor = { id: "U_MALLORY", kind: "human" };
const KEY = "C0SECRET::1700000000.000100";
const activeChannels: Channel[] = [];

function buttonIds(nodes: readonly ChannelNode[]): string[] {
  const ids: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object" || value === null || !("props" in value)) {
      return;
    }
    const node = value as ChannelNode;
    const onClick = node.props.onClick as { id?: unknown } | undefined;
    if (node.type === "button" && typeof onClick?.id === "string") {
      ids.push(onClick.id);
    }
    for (const propValue of Object.values(node.props)) visit(propValue);
  };
  visit(nodes);
  return ids;
}

/** Text of every ephemeral message the fake adapter was asked to post. */
function ephemeralTexts(fake: FakeAdapter): { user: string; text: string }[] {
  return fake.ephemeralPosts.map((p) => {
    const user = p.user as ProviderActor | string;
    return {
      user: typeof user === "string" ? user : user.id,
      text: JSON.stringify(p.ir),
    };
  });
}

async function start(opts: { nativeEphemeral: boolean; picker: boolean }) {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
  const fake = new FakeAdapter({ nativeEphemeral: opts.nativeEphemeral });
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [fake],
    agent: () => new FakeAgent(),
  });
  const card = Actions({
    children: [
      Button({ value: { ok: true }, onClick: () => {}, children: "OK" }),
    ],
  });
  channel.onMention(async ({ thread }) => {
    if (opts.picker) await thread.awaitChoice(card);
    else await thread.post(card);
  });
  await channel.ɵruntime.start();
  activeChannels.push(channel);
  fake.emitTurn({ userText: "go", conversationKey: KEY, actor: alice });
  await tick();
  const warned = () => warn.mock.calls.map((c) => c.map(String).join(" "));
  return { fake, warned, id: buttonIds(fake.posted[0]!)[0]! };
}

describe("feedback on refused and expired interactions", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    while (activeChannels.length > 0) {
      await activeChannels.pop()!.ɵruntime.stop();
    }
  });

  it("warns and tells the clicker when only the initiator may answer", async () => {
    const { fake, warned, id } = await start({
      nativeEphemeral: true,
      picker: true,
    });
    fake.emitInteraction({ id, conversationKey: KEY, actor: mallory });
    await tick();

    const line = warned().find((l) => l.includes("only the person"));
    expect(line).toContain(id);
    expect(line).toMatch(/conversation #[0-9a-f]{12}/);
    expect(line).not.toContain(KEY);
    expect(ephemeralTexts(fake)).toEqual([
      {
        user: mallory.id,
        text: expect.stringContaining("Only the person who started this"),
      },
    ]);
  });

  it("warns and tells the clicker when the action has expired", async () => {
    const { fake, warned } = await start({
      nativeEphemeral: true,
      picker: false,
    });
    fake.emitInteraction({ id: "ck:gone", conversationKey: KEY, actor: alice });
    await tick();

    const line = warned().find((l) => l.includes("expired"));
    expect(line).toContain("ck:gone");
    expect(line).not.toContain(KEY);
    expect(ephemeralTexts(fake)).toEqual([
      {
        user: alice.id,
        text: expect.stringContaining("This action has expired"),
      },
    ]);
  });

  it("warns with the action id and tells the clicker when the action belongs elsewhere", async () => {
    const { fake, warned, id } = await start({
      nativeEphemeral: true,
      picker: false,
    });
    fake.emitInteraction({
      id,
      conversationKey: "C0OTHER::1.2",
      actor: mallory,
    });
    await tick();

    const line = warned().find((l) => l.includes("outside its conversation"));
    expect(line).toContain(id);
    expect(line).not.toContain("C0OTHER::1.2");
    expect(ephemeralTexts(fake)).toEqual([
      {
        user: mallory.id,
        text: expect.stringContaining("not available here"),
      },
    ]);
  });

  it("does not fall back to a DM where the platform has no native ephemeral messages", async () => {
    const { fake, warned } = await start({
      nativeEphemeral: false,
      picker: false,
    });
    fake.emitInteraction({ id: "ck:gone", conversationKey: KEY, actor: alice });
    await tick();
    expect(warned().some((l) => l.includes("expired"))).toBe(true);
    expect(fake.ephemeralPosts).toEqual([]);
  });
});

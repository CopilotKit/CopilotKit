import { describe, it, expect, vi, afterEach } from "vitest";
import { createChannel } from "./create-channel.js";
import type { Channel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";
import { Actions, Button, Select } from "@copilotkit/channels-ui";
import type { ChannelNode, ProviderActor } from "@copilotkit/channels-ui";

/**
 * A pending `thread.awaitChoice` may only be answered by a click on one of the
 * picker's own controls, in the conversation and on the platform that posted
 * it, by the actor who started the turn (the default `answerableBy:
 * "initiator"`). Everything else must leave it pending, and must not run the
 * picker's handlers either.
 */

const tick = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

const alice: ProviderActor = { id: "U_ALICE", kind: "human" };
const mallory: ProviderActor = { id: "U_MALLORY", kind: "human" };

function findNodes(
  nodes: readonly ChannelNode[],
  type: string,
  out: ChannelNode[] = [],
): ChannelNode[] {
  for (const n of nodes) {
    if (n.type === type) out.push(n);
    const children = n.props.children;
    if (Array.isArray(children))
      findNodes(children as ChannelNode[], type, out);
  }
  return out;
}

function handlerId(node: ChannelNode, prop = "onClick"): string {
  return (node.props[prop] as { id: string }).id;
}

const PENDING = Symbol("pending");

/** Channels started by a test; stopped after each one. */
const activeChannels: Channel[] = [];

/**
 * Start a channel whose mention handler first posts an unrelated button (with
 * its own handler), then awaits a picker. Returns the handles a test needs.
 */
async function setup(opts: { initiator?: ProviderActor } = {}) {
  const fake = new FakeAdapter();
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [fake],
    agent: () => new FakeAgent(),
  });
  const state = {
    chosen: PENDING as unknown,
    approveClicks: 0,
    unrelatedClicks: 0,
  };
  channel.onMention(async ({ thread }) => {
    // An earlier card in the same conversation. Action ids are random per
    // rendered control, so its buttons never share an id with the picker's.
    // "No-op" is value-only: outside a picker it gets no action id of its own,
    // only its renderer's fallback id (Slack: its value's JSON).
    await thread.post(
      Actions({
        children: [
          Button({ value: { noop: true }, children: "No-op" }),
          Button({
            value: { unrelated: true },
            onClick: () => {
              state.unrelatedClicks++;
            },
            children: "Unrelated",
          }),
        ],
      }),
    );
    state.chosen = await thread.awaitChoice(
      Actions({
        children: [
          Button({
            value: { approved: true },
            onClick: () => {
              state.approveClicks++;
            },
            children: "Approve",
          }),
        ],
      }),
    );
  });
  await channel.ɵruntime.start();
  activeChannels.push(channel);
  fake.emitTurn({
    userText: "deploy",
    conversationKey: "c1",
    ...(opts.initiator ? { actor: opts.initiator } : {}),
  });
  await tick();
  expect(fake.posted).toHaveLength(2);
  const unrelatedId = handlerId(findNodes(fake.posted[0]!, "button")[1]!);
  const approveId = handlerId(findNodes(fake.posted[1]!, "button")[0]!);
  expect(unrelatedId).not.toBe(approveId);
  return { fake, state, unrelatedId, approveId };
}

/** Whether a debug line said the click left the pending picker alone. */
function leftPending(debug: { mock: { calls: unknown[][] } }): boolean {
  return debug.mock.calls.some((c) =>
    String(c[0]).includes("is not a control of the pending awaitChoice picker"),
  );
}

describe("awaitChoice resolution scope", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    while (activeChannels.length > 0) {
      await activeChannels.pop()!.ɵruntime.stop();
    }
  });

  it("is not resolved by an unrelated button in the same conversation", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { fake, state, unrelatedId, approveId } = await setup({
      initiator: alice,
    });

    fake.emitInteraction({
      id: unrelatedId,
      conversationKey: "c1",
      actor: alice,
      value: { unrelated: true },
    });
    await tick();

    // The unrelated button still runs its own handler...
    expect(state.unrelatedClicks).toBe(1);
    // ...but does not answer the pending choice.
    expect(state.chosen).toBe(PENDING);
    expect(leftPending(debug)).toBe(true);

    // Nor does the earlier card's value-only button, by its fallback id.
    fake.emitInteraction({
      id: JSON.stringify({ noop: true }),
      conversationKey: "c1",
      actor: alice,
      value: { noop: true },
    });
    await tick();
    expect(state.chosen).toBe(PENDING);

    fake.emitInteraction({
      id: approveId,
      conversationKey: "c1",
      actor: alice,
    });
    await tick();
    expect(state.chosen).toEqual({ approved: true });
  });

  it("is not resolved by an unknown action id carrying a forged value", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fake, state, approveId } = await setup({ initiator: alice });

    fake.emitInteraction({
      id: "ck:forged",
      conversationKey: "c1",
      actor: alice,
      value: { approved: "forged" },
    });
    await tick();
    expect(state.chosen).toBe(PENDING);

    // The forged click left the real picker pending and answerable.
    fake.emitInteraction({
      id: approveId,
      conversationKey: "c1",
      actor: alice,
    });
    await tick();
    expect(state.chosen).toEqual({ approved: true });
  });

  it("is not resolved by another participant clicking the picker", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const { fake, state, approveId } = await setup({ initiator: alice });

    fake.emitInteraction({
      id: approveId,
      conversationKey: "c1",
      actor: mallory,
    });
    await tick();
    expect(state.chosen).toBe(PENDING);
    // The picker's own handler does not run for them either.
    expect(state.approveClicks).toBe(0);

    fake.emitInteraction({
      id: approveId,
      conversationKey: "c1",
      actor: alice,
    });
    await tick();
    expect(state.chosen).toEqual({ approved: true });
    expect(state.approveClicks).toBe(1);
  });

  it("is not resolved by a click from another conversation, which runs nothing", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fake, state, approveId } = await setup({ initiator: alice });

    fake.emitInteraction({
      id: approveId,
      conversationKey: "c2",
      actor: alice,
    });
    await tick();
    expect(state.chosen).toBe(PENDING);
    expect(state.approveClicks).toBe(0);
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes("outside its conversation"),
      ),
    ).toBe(true);
  });

  it("is not resolved by a click from another platform with the same conversation key, which runs nothing", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fake, state, approveId } = await setup({ initiator: alice });

    fake.emitInteraction({
      id: approveId,
      conversationKey: "c1",
      platform: "other",
      actor: alice,
    });
    await tick();
    expect(state.chosen).toBe(PENDING);
    expect(state.approveClicks).toBe(0);
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes("outside its conversation"),
      ),
    ).toBe(true);
  });

  it.each([
    ["bot", "B_WORKFLOW"],
    ["app", "A_INTEGRATION"],
    ["system", "S_SCHEDULER"],
    ["unknown", "U_UNCLASSIFIED"],
  ] as const)(
    "locks the picker to the initiator's id whatever its kind (%s)",
    async (kind, id) => {
      vi.spyOn(console, "debug").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { fake, state, approveId } = await setup({
        initiator: { id, kind },
      });

      // ProviderActor.kind is untrusted metadata: it never opens the picker
      // to anyone else.
      fake.emitInteraction({
        id: approveId,
        conversationKey: "c1",
        actor: alice,
      });
      await tick();
      expect(state.chosen).toBe(PENDING);
      expect(state.approveClicks).toBe(0);

      fake.emitInteraction({
        id: approveId,
        conversationKey: "c1",
        actor: { id, kind: "human" },
      });
      await tick();
      expect(state.chosen).toEqual({ approved: true });
    },
  );

  it.each([
    ["the unknown placeholder", { id: "unknown", kind: "unknown" }],
    ["an empty id", { id: "", kind: "human" }],
  ] as const)(
    "refuses to wait for a choice only an unidentified initiator (%s) could answer",
    async (_label, initiator) => {
      const fake = new FakeAdapter();
      const channel = createChannel({
        identifyUser: "platform",
        adapters: [fake],
        agent: () => new FakeAgent(),
      });
      let error: unknown;
      channel.onMention(async ({ thread }) => {
        try {
          await thread.awaitChoice(
            Actions({
              children: [Button({ value: { ok: true }, children: "OK" })],
            }),
          );
        } catch (err) {
          error = err;
        }
      });
      await channel.ɵruntime.start();
      activeChannels.push(channel);
      activeChannels.push(channel);
      activeChannels.push(channel);
      fake.emitTurn({
        userText: "go",
        conversationKey: "c1",
        actor: initiator,
      });
      await tick();
      expect(error).toMatchObject({ code: "channel_choice_initiator_unknown" });
      expect(fake.posted).toHaveLength(0);
    },
  );

  it('lets anyone answer an unidentified initiator\'s picker with answerableBy: "conversation"', async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({
      identifyUser: "platform",
      adapters: [fake],
      agent: () => new FakeAgent(),
    });
    let chosen: unknown = PENDING;
    channel.onMention(async ({ thread }) => {
      chosen = await thread.awaitChoice(
        Actions({
          children: [Button({ value: { ok: true }, children: "OK" })],
        }),
        { answerableBy: "conversation" },
      );
    });
    await channel.ɵruntime.start();
    activeChannels.push(channel);
    activeChannels.push(channel);
    fake.emitTurn({
      userText: "go",
      conversationKey: "c1",
      actor: { id: "unknown", kind: "unknown" },
    });
    await tick();
    fake.emitInteraction({
      id: handlerId(findNodes(fake.posted[0]!, "button")[0]!),
      conversationKey: "c1",
      actor: alice,
    });
    await tick();
    expect(chosen).toEqual({ ok: true });
  });

  /**
   * Start a channel whose mention handler awaits `picker`, started by alice.
   * Returns the posted picker's IR so a test can read its per-post ids.
   */
  async function startPicker(picker: ChannelNode) {
    const fake = new FakeAdapter();
    const channel = createChannel({
      identifyUser: "platform",
      adapters: [fake],
      agent: () => new FakeAgent(),
    });
    const state = { chosen: PENDING as unknown };
    channel.onMention(async ({ thread }) => {
      state.chosen = await thread.awaitChoice(picker);
    });
    await channel.ɵruntime.start();
    activeChannels.push(channel);
    activeChannels.push(channel);
    fake.emitTurn({ userText: "go", conversationKey: "c1", actor: alice });
    await tick();
    return { fake, state, posted: fake.posted.at(-1)! };
  }

  it.each([
    ["Slack", (json: string) => json],
    ["Discord", (json: string) => `v:${json}`],
    ["WhatsApp", () => "wa:choice"],
  ])(
    "is not answered by a value-only control carrying the %s fallback id (a stale or unrelated card)",
    async (_platform, idFor) => {
      vi.spyOn(console, "debug").mockImplementation(() => {});
      const value = { confirmed: true };
      const { fake, state, posted } = await startPicker(
        Actions({ children: [Button({ value, children: "Approve" })] }),
      );

      // The id any other value-only button with this value arrives with.
      fake.emitInteraction({
        id: idFor(JSON.stringify(value)),
        conversationKey: "c1",
        actor: alice,
        value,
      });
      await tick();
      expect(state.chosen).toBe(PENDING);

      // The picker's own control has an id of its own, for the initiator only.
      const ownId = handlerId(findNodes(posted, "button")[0]!);
      expect(ownId).toMatch(/^ck:/);
      fake.emitInteraction({
        id: ownId,
        conversationKey: "c1",
        actor: mallory,
      });
      await tick();
      expect(state.chosen).toBe(PENDING);
      fake.emitInteraction({ id: ownId, conversationKey: "c1", actor: alice });
      await tick();
      expect(state.chosen).toEqual(value);
    },
  );

  it("answers with the button's own value, not the value a click claims", async () => {
    const { fake, state, posted } = await startPicker(
      Actions({
        children: [Button({ value: { approved: true }, children: "Approve" })],
      }),
    );
    fake.emitInteraction({
      id: handlerId(findNodes(posted, "button")[0]!),
      conversationKey: "c1",
      actor: alice,
      value: { approved: "forged", amount: 1_000_000 },
    });
    await tick();
    expect(state.chosen).toEqual({ approved: true });
  });

  it("is not answered by a handler-less select elsewhere (the Slack `select` fallback id)", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const { fake, state, posted } = await startPicker(
      Actions({
        children: [
          Select({
            placeholder: "Pick",
            options: [
              { label: "A", value: "a" },
              { label: "B", value: "b" },
            ],
          }),
        ],
      }),
    );

    for (const id of ["select", "ck:other"]) {
      fake.emitInteraction({
        id,
        conversationKey: "c1",
        actor: alice,
        value: "a",
      });
    }
    await tick();
    expect(state.chosen).toBe(PENDING);

    fake.emitInteraction({
      id: handlerId(findNodes(posted, "select")[0]!, "onSelect"),
      conversationKey: "c1",
      actor: alice,
      value: "b",
    });
    await tick();
    expect(state.chosen).toBe("b");
  });

  it("refuses a select value that is not one of the picker's options", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fake, state, posted } = await startPicker(
      Actions({
        children: [
          Select({
            placeholder: "Amount",
            options: [
              { label: "Ten", value: "10" },
              { label: "Twenty", value: "20" },
            ],
          }),
        ],
      }),
    );
    const selectId = handlerId(findNodes(posted, "select")[0]!, "onSelect");

    fake.emitInteraction({
      id: selectId,
      conversationKey: "c1",
      actor: alice,
      value: "1000000",
    });
    await tick();
    expect(state.chosen).toBe(PENDING);
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes("with a value it does not offer"),
      ),
    ).toBe(true);

    fake.emitInteraction({
      id: selectId,
      conversationKey: "c1",
      actor: alice,
      value: "20",
    });
    await tick();
    expect(state.chosen).toBe("20");
  });
});

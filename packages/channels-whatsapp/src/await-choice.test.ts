import { describe, it, expect, vi, afterEach } from "vitest";
import { createChannel, FakeAdapter } from "@copilotkit/channels-core";
import type { Channel } from "@copilotkit/channels-core";
import { Actions, Button, Select } from "@copilotkit/channels-ui";
import type { ProviderActor, Renderable } from "@copilotkit/channels-ui";
import { renderWhatsAppMessage } from "./render/message.js";
import { conversationKeyOf, decodeInteraction } from "./interaction.js";

/**
 * `thread.awaitChoice` with WhatsApp's own reply-button encoding: posts are
 * rendered by the real message renderer and taps decoded by the real
 * interaction decoder. Only the transport is faked.
 */

const PENDING = Symbol("pending");
const WA_ID = "15550001111";
const alice: ProviderActor = { id: WA_ID, kind: "human" };
const replyTarget = { to: WA_ID, phoneNumberId: "PN1" };
const activeChannels: Channel[] = [];

const tick = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Every reply-button id on the message rendered for post `index`. */
function replyIds(fake: FakeAdapter, index: number): string[] {
  const ids: string[] = [];
  for (const out of renderWhatsAppMessage(fake.posted[index]!)) {
    const buttons =
      (
        out as {
          interactive?: { action?: { buttons?: { reply: { id: string } }[] } };
        }
      ).interactive?.action?.buttons ?? [];
    for (const b of buttons) ids.push(b.reply.id);
  }
  return ids;
}

let tapSeq = 0;

/** Every list-row id on the message rendered for post `index`. */
function rowIds(fake: FakeAdapter, index: number): string[] {
  const ids: string[] = [];
  for (const out of renderWhatsAppMessage(fake.posted[index]!)) {
    const sections =
      (
        out as {
          interactive?: {
            action?: { sections?: { rows: { id: string }[] }[] };
          };
        }
      ).interactive?.action?.sections ?? [];
    for (const section of sections) {
      for (const row of section.rows) ids.push(row.id);
    }
  }
  return ids;
}

/** Tap a reply button (or pick a list row) the way the Cloud API webhook delivers it. */
function tap(
  fake: FakeAdapter,
  replyId: string,
  kind: "button" | "list" = "button",
) {
  const evt = decodeInteraction(
    {
      from: WA_ID,
      id: `wamid.tap-${++tapSeq}`,
      type: "interactive",
      interactive:
        kind === "button"
          ? { type: "button_reply", button_reply: { id: replyId, title: "x" } }
          : { type: "list_reply", list_reply: { id: replyId, title: "x" } },
    },
    replyTarget,
  );
  if (!evt) throw new Error("decoder rejected the tap");
  fake.emitInteraction({ ...evt, platform: "whatsapp" });
}

async function startPicker(
  picker: () => Renderable,
  before?: (post: (ui: Renderable) => Promise<unknown>) => Promise<void>,
) {
  const fake = new FakeAdapter({ platform: "whatsapp" });
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [fake],
  });
  const state = { chosen: PENDING as unknown };
  channel.onMention(async ({ thread }) => {
    if (before) await before((ui) => thread.post(ui));
    state.chosen = await thread.awaitChoice(picker());
  });
  await channel.ɵruntime.start();
  activeChannels.push(channel);
  fake.emitTurn({
    userText: "go",
    conversationKey: conversationKeyOf(WA_ID),
    platform: "whatsapp",
    actor: alice,
  });
  await tick();
  return { fake, state };
}

describe("WhatsApp awaitChoice", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    while (activeChannels.length > 0) {
      await activeChannels.pop()!.ɵruntime.stop();
    }
  });

  it("is answered only by the picker's own button, not an earlier value-only one", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const { fake, state } = await startPicker(
      () =>
        Actions({
          children: [
            Button({ value: { approved: true }, children: "Approve" }),
            Button({ value: { approved: false }, children: "Reject" }),
          ],
        }),
      async (post) => {
        // An unrelated earlier card whose value-only button says something else.
        await post(
          Actions({
            children: [Button({ value: { approved: "all" }, children: "Old" })],
          }),
        );
      },
    );
    const [oldId] = replyIds(fake, 0);
    const [approveId] = replyIds(fake, 1);
    expect(oldId).toBe(`wa:choice::${JSON.stringify({ approved: "all" })}`);

    tap(fake, oldId!);
    await tick();
    expect(state.chosen).toBe(PENDING);

    tap(fake, approveId!);
    await tick();
    expect(state.chosen).toEqual({ approved: true });
  });
  it("answers a multi select with the one option WhatsApp lets the user pick", async () => {
    const { fake, state } = await startPicker(() =>
      Actions({
        children: [
          Select({
            placeholder: "Regions",
            multi: true,
            options: [
              { label: "East", value: "east" },
              { label: "West", value: "west" },
            ],
          }),
        ],
      }),
    );
    const rows = rowIds(fake, 0);
    expect(rows).toHaveLength(2);

    tap(fake, rows[1]!, "list");
    await tick();
    expect(state.chosen).toEqual(["west"]);
  });
});

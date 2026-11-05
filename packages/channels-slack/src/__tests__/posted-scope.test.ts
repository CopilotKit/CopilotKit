import { describe, it, expect, vi, afterEach } from "vitest";
import { Actions, Button } from "@copilotkit/channels-ui";
import type { MessageRef } from "@copilotkit/channels-ui";
import { startSlackHarness, stopSlackHarnesses } from "./slack-harness.js";

/**
 * A card's actions are bound to the conversation a click on the card arrives
 * from, which is where Slack actually put the message: not always the thread
 * of the turn that posted or updated it.
 */

function card(label: string, clicks: string[]) {
  return Actions({
    children: [
      Button({
        value: { label },
        onClick: () => {
          clicks.push(label);
        },
        children: label,
      }),
    ],
  });
}

function refusals(warn: { mock: { calls: unknown[][] } }): string[] {
  return warn.mock.calls
    .map((c) => String(c[0]))
    .filter((line) => line.includes("refused"));
}

describe("Slack actions are scoped to where the message landed", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await stopSlackHarnesses();
  });

  it("keeps a card posted for a reaction on a threaded reply clickable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clicks: string[] = [];
    const slack = await startSlackHarness({
      setup: (channel) => {
        channel.onMention(async () => {});
        channel.onReaction(async ({ thread }) => {
          await thread.post(card("reacted", clicks));
        });
      },
    });
    // Someone replied in thread 300.0001; U1 reacts to that reply.
    slack.reply({ channel: "C1", threadTs: "300.0001", ts: "300.0002" });
    await slack.react({ channel: "C1", user: "U1", ts: "300.0002" });

    const posted = slack.posts.at(-1)!;
    // Slack filed the card under the thread's root, not under the reply.
    expect(posted.threadTs).toBe("300.0001");
    await slack.click({
      message: posted,
      element: posted.elements[0]!,
      user: "U1",
    });

    expect(refusals(warn)).toEqual([]);
    expect(clicks).toEqual(["reacted"]);
    expect(slack.errors).toEqual([]);
  });

  it("keeps a threaded bot reply clickable after a reaction updates it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clicks: string[] = [];
    const slack = await startSlackHarness({
      setup: (channel) => {
        channel.onMention(async ({ thread }) => {
          await thread.post(card("original", clicks));
        });
        channel.onReaction(async ({ thread, messageRef }) => {
          await thread.update(messageRef, card("updated", clicks));
        });
      },
    });
    await slack.mention({ channel: "C1", user: "U1", ts: "900.0001" });
    const reply = slack.posts.at(-1)!;
    expect(reply.threadTs).toBe("900.0001");

    // A reaction on the bot's reply carries no thread ts; its handler swaps
    // the reply's controls in place.
    await slack.react({ channel: "C1", user: "U1", ts: reply.ts });
    const update = slack.updates.at(-1)!;
    expect(update.ts).toBe(reply.ts);

    // The controls are scoped to the thread only: a click keyed by the reply's
    // own ts is still refused.
    await slack.click({
      message: { channel: "C1", ts: reply.ts },
      element: update.elements[0]!,
      user: "U1",
    });
    expect(refusals(warn)).toHaveLength(1);
    expect(clicks).toEqual([]);
    warn.mockClear();

    // The click comes from the reply, in the thread rooted at the mention.
    await slack.click({
      message: reply,
      element: update.elements[0]!,
      user: "U1",
    });

    expect(refusals(warn)).toEqual([]);
    expect(clicks).toEqual(["updated"]);
    expect(slack.errors).toEqual([]);
  });

  it("keeps a top-level card clickable after a turn in a thread updates it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clicks: string[] = [];
    let slashCard: MessageRef | undefined;
    const slack = await startSlackHarness({
      setup: (channel) => {
        channel.onCommand("/deploy", async ({ thread }) => {
          slashCard = await thread.post(card("original", clicks));
        });
        channel.onMention(async ({ thread }) => {
          await thread.update(slashCard!, card("updated", clicks));
        });
      },
    });
    await slack.slash({ channel: "C1", user: "U1" });
    const top = slack.posts.at(-1)!;
    expect(top.threadTs).toBeUndefined();

    // A mention in some thread updates the top-level card in place.
    await slack.mention({ channel: "C1", user: "U1", ts: "700.0001" });
    const update = slack.updates.at(-1)!;
    expect(update.ts).toBe(top.ts);

    await slack.click({
      message: { channel: "C1", ts: top.ts },
      element: update.elements[0]!,
      user: "U1",
    });

    expect(refusals(warn)).toEqual([]);
    expect(clicks).toEqual(["updated"]);
    expect(slack.errors).toEqual([]);
  });

  it("keeps a threaded card clickable after a top-level turn updates it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clicks: string[] = [];
    let threadCard: MessageRef | undefined;
    const slack = await startSlackHarness({
      setup: (channel) => {
        channel.onMention(async ({ thread }) => {
          threadCard = await thread.post(card("original", clicks));
        });
        channel.onCommand("/deploy", async ({ thread }) => {
          await thread.update(threadCard!, card("updated", clicks));
        });
      },
    });
    await slack.mention({ channel: "C1", user: "U1", ts: "800.0001" });
    const threaded = slack.posts.at(-1)!;
    expect(threaded.threadTs).toBe("800.0001");

    await slack.slash({ channel: "C1", user: "U1" });
    const update = slack.updates.at(-1)!;

    await slack.click({
      message: threaded,
      element: update.elements[0]!,
      user: "U1",
    });

    expect(refusals(warn)).toEqual([]);
    expect(clicks).toEqual(["updated"]);
  });
});

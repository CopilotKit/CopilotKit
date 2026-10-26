import { describe, it, expect, vi, afterEach } from "vitest";
import type { AgentSubscriber } from "@ag-ui/client";
import { FakeAgent } from "@copilotkit/channels-core";
import { Actions, Button } from "@copilotkit/channels-ui";
import type { SlackRespondToOptions } from "../types.js";
import { startSlackHarness, stopSlackHarnesses } from "./slack-harness.js";
import type { SlackHarness } from "./slack-harness.js";

/**
 * Human-in-the-loop on the real Slack adapter: the agent interrupts, the
 * `onInterrupt` handler posts an approval card, and a click on it resumes the
 * run (the adapter reports the `on_interrupt` custom event). Slack keys a click on a top-level message by that message's own ts, so
 * the card's continuation must be bound to that key too, or `resume()` is
 * refused as a mismatch.
 */

function interrupt(subscriber: AgentSubscriber): void {
  subscriber.onCustomEvent?.({
    event: { name: "on_interrupt", value: { requestId: "r-1" } },
  } as never);
  subscriber.onRunFinishedEvent?.({ event: {} } as never);
}

async function startApprovals(respondTo?: SlackRespondToOptions) {
  const agent = new FakeAgent([interrupt]);
  const outcome: { resumed: unknown[]; failed: unknown[] } = {
    resumed: [],
    failed: [],
  };
  const slack = await startSlackHarness({
    respondTo,
    agent: () => agent,
    setup: (channel) => {
      channel.onCommand("/deploy", async ({ thread }) => {
        await thread.runAgent({ prompt: "deploy" });
      });
      channel.onMention(async ({ thread }) => {
        await thread.runAgent();
      });
      channel.onInterrupt("on_interrupt", async ({ thread }) => {
        await thread.post(
          Actions({
            children: [
              Button({
                value: { approved: true },
                onClick: async ({ thread: clicked }) => {
                  try {
                    await clicked.resume({ approved: true });
                    outcome.resumed.push(true);
                  } catch (err) {
                    outcome.failed.push(err);
                  }
                },
                children: "Approve",
              }),
            ],
          }),
        );
      });
    },
  });
  return { slack, outcome };
}

/** Wait (bounded) until the agent run has posted `count` messages. */
async function untilPosted(slack: SlackHarness, count: number) {
  for (let i = 0; i < 200 && slack.posts.length < count; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  expect(slack.posts).toHaveLength(count);
}

/** Wait (bounded) until `done()` holds. */
async function until(done: () => boolean) {
  for (let i = 0; i < 200 && !done(); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("Slack resume() from a click on an interrupt card", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await stopSlackHarnesses();
  });

  it("resumes from a card posted in reply to a slash command", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { slack, outcome } = await startApprovals();
    await slack.slash({ channel: "C1", user: "U1", text: "prod" });
    await untilPosted(slack, 1);
    const card = slack.posts.at(-1)!;
    expect(card.threadTs).toBeUndefined();

    await slack.click({
      message: card,
      element: card.elements[0]!,
      user: "U1",
    });
    await until(() => outcome.resumed.length + outcome.failed.length > 0);

    expect(outcome.failed).toEqual([]);
    expect(outcome.resumed).toEqual([true]);
    expect(slack.errors).toEqual([]);
  });

  it("resumes from a card posted as a flat reply to a mention", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { slack, outcome } = await startApprovals({
      appMentions: { reply: "channel" },
    });
    await slack.mention({ channel: "C1", user: "U1", ts: "500.0001" });
    await untilPosted(slack, 1);
    const card = slack.posts.at(-1)!;
    expect(card.threadTs).toBeUndefined();

    await slack.click({
      message: card,
      element: card.elements[0]!,
      user: "U1",
    });
    await until(() => outcome.resumed.length + outcome.failed.length > 0);

    expect(outcome.failed).toEqual([]);
    expect(outcome.resumed).toEqual([true]);
    expect(slack.errors).toEqual([]);
  });

  it("resumes from a card posted into a mention's thread", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { slack, outcome } = await startApprovals();
    await slack.mention({ channel: "C1", user: "U1", ts: "600.0001" });
    await untilPosted(slack, 1);
    const card = slack.posts.at(-1)!;
    expect(card.threadTs).toBe("600.0001");

    await slack.click({
      message: card,
      element: card.elements[0]!,
      user: "U1",
    });
    await until(() => outcome.resumed.length + outcome.failed.length > 0);

    expect(outcome.failed).toEqual([]);
    expect(outcome.resumed).toEqual([true]);
  });

  it("still refuses the card's resume from another conversation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { slack, outcome } = await startApprovals();
    await slack.slash({ channel: "C1", user: "U1", text: "prod" });
    await untilPosted(slack, 1);
    const card = slack.posts.at(-1)!;

    await slack.click({
      message: { channel: "C1", ts: "999.0001", threadTs: "999.0001" },
      element: card.elements[0]!,
      user: "U1",
    });
    expect(outcome.resumed).toEqual([]);
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes("outside its")),
    ).toBe(true);

    // The card still resumes from its own conversation.
    await slack.click({
      message: card,
      element: card.elements[0]!,
      user: "U1",
    });
    await until(() => outcome.resumed.length + outcome.failed.length > 0);
    expect(outcome.resumed).toEqual([true]);
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { Actions, Button } from "@copilotkit/channels-ui";
import type { Thread } from "@copilotkit/channels-ui";
import type { SlackRespondToOptions } from "../types.js";
import { startSlackHarness, stopSlackHarnesses } from "./slack-harness.js";

/**
 * Cards posted through the real Slack adapter must stay clickable in the
 * conversation they were posted to, whatever ingress started the turn: the
 * action's conversation binding and the click's decoded conversation key have
 * to agree. A click from another conversation must still be refused.
 */

async function startCardChannel(respondTo?: SlackRespondToOptions) {
  const clicks: string[] = [];
  const postCard = async (thread: Pick<Thread, "post">, owner: string) => {
    await thread.post(
      Actions({
        children: [
          Button({
            value: { ok: true },
            onClick: () => {
              clicks.push(owner);
            },
            children: "OK",
          }),
        ],
      }),
    );
  };
  const slack = await startSlackHarness({
    respondTo,
    setup: (channel) => {
      channel.onCommand("/deploy", async ({ thread }) =>
        postCard(thread, "slash"),
      );
      channel.onMention(async ({ thread }) => postCard(thread, "mention"));
      channel.onMessage(async ({ thread }) => postCard(thread, "dm"));
    },
  });
  const lastCard = () => {
    const post = slack.posts.at(-1)!;
    return { post, button: post.elements[0]! };
  };
  return { slack, clicks, lastCard };
}

describe("Slack card clicks resolve in the conversation the card was posted to", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await stopSlackHarnesses();
  });

  it("runs the handler of a card posted from a slash command", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { slack, clicks, lastCard } = await startCardChannel();
    await slack.slash({ channel: "C1", user: "U1", text: "prod" });
    const { post, button } = lastCard();
    expect(post.threadTs).toBeUndefined();

    await slack.click({ message: post, element: button, user: "U1" });
    expect(clicks).toEqual(["slash"]);
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes("outside its")),
    ).toBe(false);
  });

  it("runs the handler of a card posted as a flat reply to a mention", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { slack, clicks, lastCard } = await startCardChannel({
      appMentions: { reply: "channel" },
    });
    await slack.mention({ channel: "C1", user: "U1", ts: "500.0001" });
    const { post, button } = lastCard();
    expect(post.threadTs).toBeUndefined();

    await slack.click({ message: post, element: button, user: "U1" });
    expect(clicks).toEqual(["mention"]);
  });

  it("runs the handler of a card posted into a mention's thread", async () => {
    const { slack, clicks, lastCard } = await startCardChannel();
    await slack.mention({ channel: "C1", user: "U1", ts: "600.0001" });
    const { post, button } = lastCard();
    expect(post.threadTs).toBe("600.0001");

    await slack.click({ message: post, element: button, user: "U1" });
    expect(clicks).toEqual(["mention"]);
  });

  it("runs the handler of a card posted in a DM", async () => {
    const { slack, clicks, lastCard } = await startCardChannel();
    await slack.dm({ channel: "D1", user: "U1", ts: "700.0001" });
    const { post, button } = lastCard();

    await slack.click({ message: post, element: button, user: "U1" });
    expect(clicks).toEqual(["dm"]);
  });

  it("still refuses a card's action presented from another conversation", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { slack, clicks, lastCard } = await startCardChannel();
    await slack.slash({ channel: "C1", user: "U1", text: "prod" });
    const { post, button } = lastCard();

    // Same action id, clicked from another channel and from another thread.
    await slack.click({
      message: { channel: "C2", ts: post.ts },
      element: button,
      user: "U2",
    });
    await slack.click({
      message: { channel: "C1", ts: "999.0001", threadTs: "999.0001" },
      element: button,
      user: "U2",
    });
    expect(clicks).toEqual([]);
    expect(
      warn.mock.calls.filter((c) => String(c[0]).includes("outside its")),
    ).toHaveLength(2);
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { Actions, Button } from "@copilotkit/channels-ui";
import { startSlackHarness, stopSlackHarnesses } from "./slack-harness.js";
import type { SlackHarness } from "./slack-harness.js";

/**
 * Slack delivers `block_actions` for every button, link buttons and buttons
 * without a handler included. Those controls never had an action to run, so a
 * click on one is ignored quietly. Only a bound action that has expired or
 * been revoked is logged and explained to the person who clicked.
 */

function refusals(warn: { mock: { calls: unknown[][] } }): string[] {
  return warn.mock.calls
    .map((c) => String(c[0]))
    .filter((line) => line.includes("refused"));
}

function ephemeralText(slack: SlackHarness): string[] {
  return slack.ephemerals.map((e) => JSON.stringify(e.blocks));
}

async function postCard() {
  const clicks: string[] = [];
  const slack = await startSlackHarness({
    setup: (channel) => {
      channel.onMention(async ({ thread }) => {
        await thread.post(
          Actions({
            children: [
              Button({ url: "https://example.com/docs", children: "Docs" }),
              Button({ value: { noop: true }, children: "No-op" }),
              Button({ children: "Nothing" }),
              Button({
                value: { ok: true },
                onClick: () => {
                  clicks.push("ok");
                },
                children: "OK",
              }),
            ],
          }),
        );
      });
    },
  });
  await slack.mention({ channel: "C1", user: "U1", ts: "100.0001" });
  const card = slack.posts.at(-1)!;
  return { slack, card, clicks };
}

describe("Slack clicks on controls without an action", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await stopSlackHarnesses();
  });

  it("ignores a link-button click without telling the user anything", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { slack, card } = await postCard();
    const link = card.elements[0]!;

    await slack.click({ message: card, element: link, user: "U1" });

    expect(slack.ephemerals).toEqual([]);
    expect(refusals(warn)).toEqual([]);
    expect(slack.errors).toEqual([]);
    expect(debug).toHaveBeenCalled();
  });

  it("ignores clicks on buttons that never had a handler", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const { slack, card } = await postCard();

    await slack.click({
      message: card,
      element: card.elements[1]!,
      user: "U1",
    });
    await slack.click({
      message: card,
      element: card.elements[2]!,
      user: "U1",
    });

    expect(slack.ephemerals).toEqual([]);
    expect(refusals(warn)).toEqual([]);
    expect(slack.errors).toEqual([]);
  });

  it("still tells the clicker when a bound action has expired", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { slack, card, clicks } = await postCard();
    const ok = card.elements[3]!;
    expect(ok.action_id).toMatch(/^ck:/);

    // A minted id the registry no longer holds: expired, or revoked.
    await slack.click({
      message: card,
      element: { ...ok, action_id: "ck:AAAAAAAAAAAAAAAAAAAAAA" },
      user: "U1",
    });

    expect(clicks).toEqual([]);
    expect(refusals(warn)).toHaveLength(1);
    expect(ephemeralText(slack).join()).toContain("This action has expired.");

    // The card's own action still runs.
    await slack.click({ message: card, element: ok, user: "U1" });
    expect(clicks).toEqual(["ok"]);
  });
});

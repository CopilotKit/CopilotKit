import { describe, it, expect } from "vitest";
import { decideChannelResponse } from "./response-policy.js";

const decide = (o: {
  kind?: "direct_message" | "channel" | "thread" | "assistant";
  mentioned?: boolean;
  mention?: boolean;
  message?: boolean;
}) =>
  decideChannelResponse({
    conversationKind: o.kind ?? "channel",
    mentioned: o.mentioned ?? false,
    hasMentionHandler: o.mention ?? false,
    hasMessageHandler: o.message ?? false,
  });

describe("decideChannelResponse — addressing", () => {
  it("treats a DM as addressed and auto-runs when no handler matches", () => {
    expect(decide({ kind: "direct_message" })).toEqual({ action: "auto_run" });
  });

  it("treats the assistant pane as addressed", () => {
    expect(decide({ kind: "assistant" })).toEqual({ action: "auto_run" });
  });

  it("auto-runs a mentioned shared-channel message with no handler", () => {
    expect(decide({ kind: "channel", mentioned: true })).toEqual({
      action: "auto_run",
    });
  });

  it("ignores an untagged shared-channel message with no handler", () => {
    expect(decide({ kind: "channel", mentioned: false })).toEqual({
      action: "ignore",
    });
  });

  it("ignores an untagged shared thread even with an onMention handler", () => {
    // onMention never fires for an untagged shared message; only onMessage opts in.
    expect(decide({ kind: "thread", mentioned: false, mention: true })).toEqual(
      { action: "ignore" },
    );
  });
});

describe("decideChannelResponse — handler precedence + suppression", () => {
  it("runs the onMention handler for an addressed message (suppresses auto-run)", () => {
    expect(decide({ kind: "channel", mentioned: true, mention: true })).toEqual(
      { action: "handler", handler: "mention" },
    );
  });

  it("prefers onMention over onMessage when both match an addressed message", () => {
    expect(
      decide({ kind: "direct_message", mention: true, message: true }),
    ).toEqual({ action: "handler", handler: "mention" });
  });

  it("runs onMessage for an addressed message when only onMessage matches", () => {
    expect(decide({ kind: "direct_message", message: true })).toEqual({
      action: "handler",
      handler: "message",
    });
  });

  it("lets onMessage opt into an untagged shared message", () => {
    expect(
      decide({ kind: "channel", mentioned: false, message: true }),
    ).toEqual({ action: "handler", handler: "message" });
  });
});

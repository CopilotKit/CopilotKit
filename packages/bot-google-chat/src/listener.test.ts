// listener.test.ts
import { describe, it, expect, vi } from "vitest";
import { routeChatEvent } from "./listener.js";

function handlers() {
  return {
    onTurn: vi.fn(async () => {}),
    onCommand: vi.fn(async () => {}),
    onThreadStarted: vi.fn(async () => {}),
  };
}

describe("routeChatEvent", () => {
  it("routes a plain MESSAGE to onTurn with thread scope", async () => {
    const h = handlers();
    await routeChatEvent(
      {
        type: "MESSAGE",
        space: { name: "spaces/A", type: "ROOM" },
        message: {
          argumentText: " hi ",
          thread: { name: "spaces/A/threads/T" },
          sender: { name: "users/1", displayName: "Ada", type: "HUMAN" },
        },
      },
      { botUserId: "users/BOT", handlers: h },
    );
    expect(h.onTurn).toHaveBeenCalledTimes(1);
    const turn = h.onTurn.mock.calls[0][0];
    expect(turn.userText).toBe("hi");
    expect(turn.conversation).toEqual({
      spaceId: "spaces/A",
      scope: "spaces/A/threads/T",
    });
    expect(turn.replyTarget).toEqual({
      space: "spaces/A",
      thread: "spaces/A/threads/T",
      senderName: "Ada",
    });
  });

  it("routes a slash command to onCommand", async () => {
    const h = handlers();
    await routeChatEvent(
      {
        type: "MESSAGE",
        space: { name: "spaces/A", type: "ROOM" },
        message: {
          slashCommand: { commandName: "/reset" },
          argumentText: "now",
          thread: { name: "spaces/A/threads/T" },
          sender: { name: "users/1", type: "HUMAN" },
        },
      },
      { botUserId: "users/BOT", handlers: h },
    );
    expect(h.onCommand).toHaveBeenCalledTimes(1);
    expect(h.onCommand.mock.calls[0][0]).toMatchObject({
      command: "/reset",
      text: "now",
    });
  });

  it("ignores the bot's own messages", async () => {
    const h = handlers();
    await routeChatEvent(
      {
        type: "MESSAGE",
        space: { name: "spaces/A", type: "ROOM" },
        message: { text: "loop", sender: { name: "users/BOT", type: "BOT" } },
      },
      { botUserId: "users/BOT", handlers: h },
    );
    expect(h.onTurn).not.toHaveBeenCalled();
  });

  it("uses DM scope for a DM space and routes ADDED_TO_SPACE to onThreadStarted", async () => {
    const h = handlers();
    await routeChatEvent(
      {
        type: "ADDED_TO_SPACE",
        space: { name: "spaces/D", type: "DM" },
        user: { name: "users/1" },
      },
      { botUserId: "users/BOT", handlers: h },
    );
    expect(h.onThreadStarted).toHaveBeenCalledTimes(1);
    expect(h.onThreadStarted.mock.calls[0][0].conversation).toEqual({
      spaceId: "spaces/D",
      scope: "dm",
    });
  });
});

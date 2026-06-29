/**
 * `read_thread` maps the platform-agnostic `thread.getMessages()` result into a
 * compact chronological transcript for the agent. We drive it with a fake
 * `thread` that returns a couple of messages and assert the shape.
 */
import { describe, it, expect } from "vitest";
import { readThreadTool } from "../read-thread.js";

describe("read_thread tool", () => {
  it("returns a compact transcript of the thread messages", async () => {
    const messages = [
      {
        user: { name: "Ada" },
        text: "the build is broken",
        ts: "1",
        isBot: false,
      },
      { user: { name: "Lin" }, text: "since when?", ts: "2", isBot: false },
    ];
    const ctx = {
      thread: { getMessages: async () => messages },
    } as never;

    const result = (await readThreadTool.handler({}, ctx)) as {
      count: number;
      messages: { user: string; text: string; ts: string }[];
    };

    expect(result.count).toBe(2);
    expect(result.messages[0]).toEqual({
      user: "Ada",
      text: "the build is broken",
      ts: "1",
    });
    expect(result.messages[1]!.user).toBe("Lin");
  });

  it("falls back to 'bot'/'unknown' when the author can't be resolved", async () => {
    const ctx = {
      thread: {
        getMessages: async () => [
          { user: undefined, text: "beep", ts: "1", isBot: true },
          { user: undefined, text: "?", ts: "2", isBot: false },
        ],
      },
    } as never;

    const result = (await readThreadTool.handler({}, ctx)) as {
      messages: { user: string }[];
    };

    expect(result.messages[0]!.user).toBe("bot");
    expect(result.messages[1]!.user).toBe("unknown");
  });
});

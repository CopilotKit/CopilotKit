import { describe, it, expect, vi } from "vitest";
import { readThreadTool } from "../read-thread.js";
import type { ThreadMessage } from "@copilotkit/bot-ui";

/** The ctx a BotTool handler receives. */
type HandlerCtx = Parameters<typeof readThreadTool.handler>[1];

/**
 * Build a fake handler ctx. The handler only touches
 * `thread.getMessages()`; the other `BotToolContext` fields are unused by
 * this tool, so we cast the minimal literal to the handler ctx type.
 */
function makeCtx(messages: ThreadMessage[]): HandlerCtx {
  const thread = { getMessages: vi.fn(async () => messages) };
  return { thread } as unknown as HandlerCtx;
}

describe("read_thread tool", () => {
  it("returns the thread messages in a normalized shape", async () => {
    const ctx = makeCtx([
      {
        user: { id: "UALICE", name: "Alice" },
        text: "checkout is 500ing",
        ts: "1700000000.000100",
      },
      {
        user: { id: "UBOT", name: "Triage Bot" },
        text: "looking into it",
        ts: "1700000000.000200",
        isBot: true,
      },
      {
        text: "alert: error rate 12%",
        ts: "1700000000.000300",
        isBot: true,
      },
    ]);

    const out = (await readThreadTool.handler({}, ctx)) as {
      count: number;
      messages: Array<{ user: string; text: string; ts?: string }>;
    };

    expect(out.count).toBe(3);
    expect(out.messages).toHaveLength(3);
    expect(out.messages[0]).toMatchObject({
      user: "Alice",
      text: "checkout is 500ing",
      ts: "1700000000.000100",
    });
    expect(out.messages[1]?.user).toBe("Triage Bot");
    // A user-less bot message falls back to the "bot" label.
    expect(out.messages[2]).toMatchObject({ user: "bot" });
  });

  it("returns an empty list when there is no history", async () => {
    const ctx = makeCtx([]);

    const out = (await readThreadTool.handler({}, ctx)) as {
      count: number;
      messages: unknown[];
    };

    expect(out.count).toBe(0);
    expect(out.messages).toEqual([]);
  });

  it("labels a user-less, non-bot message as unknown", async () => {
    const ctx = makeCtx([{ text: "system note", ts: "1.0" }]);

    const out = (await readThreadTool.handler({}, ctx)) as {
      messages: Array<{ user: string }>;
    };

    expect(out.messages[0]?.user).toBe("unknown");
  });

  it("calls thread.getMessages once", async () => {
    const ctx = makeCtx([]);
    await readThreadTool.handler({}, ctx);
    expect(ctx.thread.getMessages).toHaveBeenCalledTimes(1);
  });
});

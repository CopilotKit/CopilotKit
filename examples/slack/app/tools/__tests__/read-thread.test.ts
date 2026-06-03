import { describe, it, expect, vi } from "vitest";
import { readThreadTool } from "../read-thread.js";
import type { FrontendToolContext } from "@copilotkit/slack";

/**
 * Build a fake FrontendToolContext. Follows the slack package's own test
 * convention of `client: {...} as never` for the WebClient stub — the
 * handler only touches `client.conversations.replies`.
 */
function makeCtx(
  repliesImpl: () => unknown,
  overrides: Partial<FrontendToolContext> = {},
): FrontendToolContext {
  return {
    client: { conversations: { replies: vi.fn(repliesImpl) } } as never,
    channel: "C123",
    threadTs: "1700000000.000100",
    botUserId: "UBOT",
    conversationKey: "C123::1700000000.000100",
    postFile: async () => ({ ok: true }),
    ...overrides,
  };
}

describe("read_thread tool", () => {
  it("returns the thread messages in a normalized shape", async () => {
    const ctx = makeCtx(() => ({
      ok: true,
      messages: [
        { user: "UALICE", text: "checkout is 500ing", ts: "1700000000.000100" },
        { user: "UBOT", text: "looking into it", ts: "1700000000.000200" },
        {
          bot_id: "BPAGER",
          text: "alert: error rate 12%",
          ts: "1700000000.000300",
        },
      ],
    }));

    const out = JSON.parse((await readThreadTool.handler({}, ctx)) as string);

    expect(out.ok).toBe(true);
    expect(out.messages).toHaveLength(3);
    expect(out.messages[0]).toMatchObject({
      author: "<@UALICE>",
      isBot: false,
      text: "checkout is 500ing",
    });
    // The bot's own message is flagged.
    expect(out.messages[1].isBot).toBe(true);
    // A bot_id-only message is attributed and flagged as a bot.
    expect(out.messages[2]).toMatchObject({ author: "BPAGER", isBot: true });
  });

  it("short-circuits with an empty list when there is no thread", async () => {
    const replies = vi.fn(() => ({ ok: true, messages: [] }));
    const ctx = makeCtx(replies, { threadTs: undefined });

    const out = JSON.parse((await readThreadTool.handler({}, ctx)) as string);

    expect(out.ok).toBe(true);
    expect(out.messages).toEqual([]);
    expect(out.note).toMatch(/not in a thread/i);
    // No Slack call when there's nothing to read.
    expect(replies).not.toHaveBeenCalled();
  });

  it("degrades gracefully when the Slack call throws", async () => {
    const ctx = makeCtx(() => {
      throw new Error("missing_scope");
    });

    const out = JSON.parse((await readThreadTool.handler({}, ctx)) as string);

    expect(out.ok).toBe(false);
    expect(out.error).toBe("missing_scope");
    expect(out.hint).toMatch(/scope/i);
  });

  it("forwards the limit to conversations.replies", async () => {
    const replies = vi.fn(() => ({ ok: true, messages: [] }));
    const ctx = makeCtx(replies);

    await readThreadTool.handler({ limit: 25 }, ctx);

    expect(replies).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "C123", ts: ctx.threadTs, limit: 25 }),
    );
  });
});

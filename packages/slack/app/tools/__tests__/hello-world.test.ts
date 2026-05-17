import { describe, it, expect, vi } from "vitest";
import { helloWorldTool } from "../hello-world.js";
import type { FrontendToolContext } from "../../../src/index.js";

/**
 * These tests double as a template — they show how an app can unit-test
 * its own frontend tools by faking the Slack `WebClient` and the
 * `FrontendToolContext` directly.
 */

function makeCtx(channelInfo: { ok: boolean; channel?: { name?: string } }): {
  ctx: FrontendToolContext;
  infoFn: ReturnType<typeof vi.fn>;
} {
  const infoFn = vi.fn(async () => channelInfo);
  const ctx = {
    client: { conversations: { info: infoFn } } as never,
    channel: "C1",
    threadTs: "100.0",
    botUserId: "BOT01",
    conversationKey: "C1::100.0",
  } satisfies FrontendToolContext;
  return { ctx, infoFn };
}

describe("hello_world example tool", () => {
  it("greets the recipient and includes the resolved channel name", async () => {
    const { ctx, infoFn } = makeCtx({ ok: true, channel: { name: "general" } });
    const r = JSON.parse(
      await helloWorldTool.execute({ recipient: "Atai" }, ctx),
    );
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Hello, Atai! Greeting from #general.");
    expect(r.ctx).toEqual({
      channel: "C1",
      channelName: "general",
      threadTs: "100.0",
      botUserId: "BOT01",
    });
    expect(infoFn).toHaveBeenCalledWith({ channel: "C1" });
  });

  it("falls back gracefully when conversations.info returns no name", async () => {
    const { ctx } = makeCtx({ ok: true, channel: {} });
    const r = JSON.parse(
      await helloWorldTool.execute({ recipient: "Atai" }, ctx),
    );
    expect(r.message).toBe("Hello, Atai!");
    expect(r.ctx.channelName).toBeUndefined();
  });

  it("falls back gracefully when conversations.info throws (missing scope, DM, etc.)", async () => {
    const ctx = {
      client: {
        conversations: {
          info: vi.fn(async () => {
            throw new Error("missing_scope");
          }),
        },
      } as never,
      channel: "D1",
      botUserId: "BOT01",
      conversationKey: "C1::100.0",
    } satisfies FrontendToolContext;
    const r = JSON.parse(
      await helloWorldTool.execute({ recipient: "Atai" }, ctx),
    );
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Hello, Atai!");
    expect(r.slackLookupError).toContain("missing_scope");
  });
});

import { describe, it, expect, vi } from "vitest";
import { lookupSlackUserTool, defaultSlackTools } from "../built-in-tools.js";
import {
  defaultSlackContext,
  slackTaggingContext,
  slackFormattingContext,
  slackConversationModelContext,
} from "../built-in-context.js";
import type { BotToolContext } from "@copilotkit/bot";
import type { PlatformUser, Thread } from "@copilotkit/bot-ui";

/**
 * Build a minimal handler ctx whose `thread.lookupUser` is the only capability
 * the lookup tool touches. The fake resolves to whatever `user` we hand it.
 */
function makeCtx(user?: PlatformUser): {
  ctx: BotToolContext;
  lookupUser: ReturnType<typeof vi.fn>;
} {
  const lookupUser = vi.fn(async (_query: string) => user);
  const thread = { lookupUser } as unknown as Thread;
  return {
    ctx: { thread, platform: "slack" } as BotToolContext,
    lookupUser,
  };
}

describe("lookup_slack_user", () => {
  it("resolves a user via thread.lookupUser and returns a <@USERID> mention", async () => {
    const { ctx, lookupUser } = makeCtx({
      id: "U001",
      name: "Atai Barkai",
      handle: "atai",
      email: "atai@copilotkit.ai",
    });
    const r = (await lookupSlackUserTool.handler({ query: "atai" }, ctx)) as {
      found: boolean;
      userId?: string;
      mention?: string;
      name?: string;
      email?: string;
    };
    expect(lookupUser).toHaveBeenCalledWith("atai");
    expect(r.found).toBe(true);
    expect(r.userId).toBe("U001");
    expect(r.name).toBe("Atai Barkai");
    expect(r.email).toBe("atai@copilotkit.ai");
    expect(r.mention).toBe("<@U001>");
  });

  it("returns found:false (with the query echoed) when no user resolves", async () => {
    const { ctx } = makeCtx(undefined);
    const r = (await lookupSlackUserTool.handler(
      { query: "Nobody von Nope" },
      ctx,
    )) as { found: boolean; query?: string };
    expect(r.found).toBe(false);
    expect(r.query).toBe("Nobody von Nope");
  });

  it("returns a raw object (NOT a JSON string) for the run-loop to serialize", async () => {
    const { ctx } = makeCtx({ id: "U002" });
    const r = await lookupSlackUserTool.handler({ query: "sarah" }, ctx);
    expect(typeof r).toBe("object");
  });
});

describe("default consts", () => {
  it("defaultSlackTools is just the lookup tool", () => {
    expect(defaultSlackTools.map((t) => t.name)).toEqual(["lookup_slack_user"]);
  });

  it("defaultSlackContext is the tagging + formatting + conversation-model entries", () => {
    expect(defaultSlackContext).toEqual([
      slackTaggingContext,
      slackFormattingContext,
      slackConversationModelContext,
    ]);
  });

  it("tagging entry references the lookup tool by name", () => {
    expect(slackTaggingContext.value).toContain("lookup_slack_user");
    expect(slackTaggingContext.value).toContain("<@USERID>");
  });

  it("formatting entry talks about Markdown -> mrkdwn", () => {
    expect(slackFormattingContext.value).toContain("Markdown");
    expect(slackFormattingContext.value).toContain("mrkdwn");
  });

  it("conversation-model entry talks about threads and DMs", () => {
    expect(slackConversationModelContext.value).toContain("thread");
    expect(slackConversationModelContext.value.toLowerCase()).toContain("dm");
  });
});

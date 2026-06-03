import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  lookupSlackUserTool,
  _resetLookupCache,
  defaultSlackTools,
} from "../built-in-tools.js";
import {
  defaultSlackContext,
  slackTaggingContext,
  slackFormattingContext,
  slackConversationModelContext,
} from "../built-in-context.js";
import type { FrontendToolContext } from "../frontend-tools.js";

const members = [
  {
    id: "U001",
    name: "atai",
    real_name: "Atai Barkai",
    profile: {
      real_name: "Atai Barkai",
      display_name: "Atai",
      display_name_normalized: "atai",
      real_name_normalized: "atai barkai",
      email: "atai@copilotkit.ai",
    },
  },
  {
    id: "U002",
    name: "sarah",
    real_name: "Sarah Chen",
    profile: {
      real_name: "Sarah Chen",
      display_name: "Sarah",
      display_name_normalized: "sarah",
      real_name_normalized: "sarah chen",
      email: "sarah@copilotkit.ai",
    },
  },
  {
    id: "BOT01",
    name: "ag-ui-bot",
    is_bot: true,
    real_name: "AG-UI Bot",
    profile: { real_name: "AG-UI Bot", display_name: "AG-UI Bot" },
  },
  {
    id: "U003",
    name: "departed",
    deleted: true,
    real_name: "Departed User",
    profile: { real_name: "Departed User" },
  },
];

function makeCtx(): {
  ctx: FrontendToolContext;
  listFn: ReturnType<typeof vi.fn>;
} {
  const listFn = vi.fn(async () => ({
    ok: true,
    members,
    response_metadata: {},
  }));
  const ctx = {
    client: { users: { list: listFn } } as never,
    channel: "C1",
    threadTs: "100.0",
    botUserId: "BOT01",
    conversationKey: "C1::100.0",
    postFile: async () => ({ ok: true }),
  } satisfies FrontendToolContext;
  return { ctx, listFn };
}

describe("lookup_slack_user", () => {
  beforeEach(() => _resetLookupCache());

  it("resolves by exact handle and returns a <@USERID> mention string", async () => {
    const { ctx } = makeCtx();
    const r = JSON.parse(
      (await lookupSlackUserTool.handler({ query: "atai" }, ctx)) as string,
    );
    expect(r.found).toBe(true);
    expect(r.userId).toBe("U001");
    expect(r.mention).toBe("<@U001>");
  });

  it("resolves by display name", async () => {
    const { ctx } = makeCtx();
    const r = JSON.parse(
      (await lookupSlackUserTool.handler({ query: "Sarah" }, ctx)) as string,
    );
    expect(r.userId).toBe("U002");
  });

  it("resolves by first name", async () => {
    const { ctx } = makeCtx();
    const r = JSON.parse(
      (await lookupSlackUserTool.handler({ query: "Atai" }, ctx)) as string,
    );
    expect(r.userId).toBe("U001");
  });

  it("resolves by email", async () => {
    const { ctx } = makeCtx();
    const r = JSON.parse(
      (await lookupSlackUserTool.handler(
        { query: "sarah@copilotkit.ai" },
        ctx,
      )) as string,
    );
    expect(r.userId).toBe("U002");
  });

  it("returns found:false for unknown query — gracefully, not an error", async () => {
    const { ctx } = makeCtx();
    const r = JSON.parse(
      (await lookupSlackUserTool.handler(
        { query: "Nobody von Nope" },
        ctx,
      )) as string,
    );
    expect(r.found).toBe(false);
  });

  it("excludes bots and deleted users", async () => {
    const { ctx } = makeCtx();
    const a = JSON.parse(
      (await lookupSlackUserTool.handler(
        { query: "ag-ui-bot" },
        ctx,
      )) as string,
    );
    expect(a.found).toBe(false);
    const b = JSON.parse(
      (await lookupSlackUserTool.handler({ query: "departed" }, ctx)) as string,
    );
    expect(b.found).toBe(false);
  });

  it("caches the directory across calls (only one users.list per TTL)", async () => {
    const { ctx, listFn } = makeCtx();
    (await lookupSlackUserTool.handler({ query: "atai" }, ctx)) as string;
    (await lookupSlackUserTool.handler({ query: "sarah" }, ctx)) as string;
    expect(listFn).toHaveBeenCalledTimes(1);
  });

  it("returns found:false (with reason) if users.list throws", async () => {
    const ctx = {
      client: {
        users: {
          list: vi.fn(async () => {
            throw new Error("rate limited");
          }),
        },
      } as never,
      channel: "C1",
      botUserId: "BOT01",
      conversationKey: "C1::100.0",
      postFile: async () => ({ ok: true }),
    } satisfies FrontendToolContext;
    const r = JSON.parse(
      (await lookupSlackUserTool.handler({ query: "atai" }, ctx)) as string,
    );
    expect(r.found).toBe(false);
    expect(r.reason).toContain("rate limited");
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

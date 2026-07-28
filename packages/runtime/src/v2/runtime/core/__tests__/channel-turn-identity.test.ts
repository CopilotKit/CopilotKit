import { describe, it, expect, vi, beforeEach } from "vitest";

const attach = vi.hoisted(() => vi.fn());
vi.mock("../../handlers/shared/agent-utils", () => ({
  attachIntelligenceEnterpriseLearning: attach,
}));

import { prepareChannelTurnAgent } from "../channel-turn-identity";

const runtime = {} as never;
const agent = {} as never;

beforeEach(() => {
  attach.mockClear();
});

describe("prepareChannelTurnAgent", () => {
  it("attaches user-scoped tools for a direct-message turn", async () => {
    await prepareChannelTurnAgent({
      runtime,
      agent,
      user: { id: "U9", appUserId: "slack:T1:U9", name: "Ada" },
      conversationScope: "direct",
      memoryPolicy: "direct-only",
    });
    expect(attach).toHaveBeenCalledWith({
      runtime,
      agent,
      user: { id: "slack:T1:U9", name: "Ada" },
    });
  });

  it("uses the canonical appUserId, never the raw provider id", async () => {
    await prepareChannelTurnAgent({
      runtime,
      agent,
      user: { id: "U9", appUserId: "slack:T1:U9" },
      conversationScope: "direct",
      memoryPolicy: "direct-only",
    });
    // `U9` would collide across workspaces and would not match
    // threads.end_user_id, so memory would attach to a different user than the
    // canonical thread.
    expect(attach.mock.calls[0]?.[0].user.id).toBe("slack:T1:U9");
  });

  it("does NOT attach user-private tools in a shared conversation by default", async () => {
    await prepareChannelTurnAgent({
      runtime,
      agent,
      user: { id: "U9", appUserId: "slack:T1:U9", name: "Ada" },
      conversationScope: "shared",
      memoryPolicy: "direct-only",
    });
    expect(attach).not.toHaveBeenCalled();
  });

  it("attaches in a shared conversation only when the operator opted in", async () => {
    await prepareChannelTurnAgent({
      runtime,
      agent,
      user: { id: "U9", appUserId: "slack:T1:U9", name: "Ada" },
      conversationScope: "shared",
      memoryPolicy: "shared",
    });
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it("attaches nothing when the turn carries no canonical app user", async () => {
    await prepareChannelTurnAgent({
      runtime,
      agent,
      user: { id: "U9" },
      conversationScope: "direct",
      memoryPolicy: "direct-only",
    });
    expect(attach).not.toHaveBeenCalled();
  });

  it("attaches nothing when the turn carries no user at all", async () => {
    await prepareChannelTurnAgent({
      runtime,
      agent,
      conversationScope: "direct",
      memoryPolicy: "direct-only",
    });
    expect(attach).not.toHaveBeenCalled();
  });

  it("falls back to the id when the sender has no display name", async () => {
    // A name is profile data — it must never decide whether identity validates.
    await prepareChannelTurnAgent({
      runtime,
      agent,
      user: { id: "U9", appUserId: "slack:T1:U9", name: "   " },
      conversationScope: "direct",
      memoryPolicy: "direct-only",
    });
    expect(attach.mock.calls[0]?.[0].user).toEqual({
      id: "slack:T1:U9",
      name: "slack:T1:U9",
    });
  });

  it("accepts a long opaque Teams app-user id", async () => {
    const appUserId = `teams:tenant1:29:1${"a".repeat(200)}`;
    await prepareChannelTurnAgent({
      runtime,
      agent,
      user: { id: `29:1${"a".repeat(200)}`, appUserId },
      conversationScope: "direct",
      memoryPolicy: "direct-only",
    });
    expect(attach.mock.calls[0]?.[0].user.id).toBe(appUserId);
  });

  it("rejects an app-user id that could forge a header", async () => {
    await prepareChannelTurnAgent({
      runtime,
      agent,
      user: { id: "U9", appUserId: "slack:T1:U9\r\nx-injected: 1" },
      conversationScope: "direct",
      memoryPolicy: "direct-only",
    });
    expect(attach).not.toHaveBeenCalled();
  });
});

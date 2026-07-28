import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";

/**
 * AC #4 (OSS-643): an HTTP Intelligence run and a managed Channel turn resolve
 * their users from DIFFERENT sources, and those sources must stay isolated under
 * concurrency. The failure this guards against is a shared/ambient identity —
 * a module-level "current user", a mutable closure, an async-local slot — where
 * interleaving two runs lets one observe the other's sender.
 *
 * Both paths funnel into `attachIntelligenceEnterpriseLearning`, so capturing
 * the header it bakes into each middleware is enough to see whose identity each
 * run actually used.
 */
const attachedUserIds: string[] = [];
const mcpMiddlewareCalls: Array<unknown[]> = [];

vi.mock("@ag-ui/mcp-middleware", () => ({
  MCPMiddleware: class {
    constructor(...args: unknown[]) {
      mcpMiddlewareCalls.push(args);
      const servers = args[0] as Array<{ headers?: Record<string, string> }>;
      const id = servers?.[0]?.headers?.["x-cpki-user-id"];
      if (id) attachedUserIds.push(id);
    }
  },
}));

import { attachIntelligenceEnterpriseLearning } from "../handlers/shared/agent-utils";
import { resolveIntelligenceUser } from "../handlers/shared/resolve-intelligence-user";
import { prepareChannelTurnAgent } from "../core/channel-turn-identity";

const makeAgent = () =>
  ({ use: vi.fn() }) as unknown as AbstractAgent & { use: ReturnType<typeof vi.fn> };

const makeRuntime = (identifyUser?: unknown) =>
  ({
    mode: "intelligence",
    identifyUser,
    intelligence: {
      ɵisEnterpriseLearningEnabled: () => true,
      ɵgetApiUrl: () => "https://intelligence.example",
      ɵgetApiKey: () => "cpk-test",
    },
  }) as never;

/** One HTTP run: resolve via identifyUser, then attach. */
const httpRun = async (userId: string) => {
  const runtime = makeRuntime(async () => ({ id: userId, name: userId }));
  const agent = makeAgent();
  const user = await resolveIntelligenceUser({
    runtime,
    request: new Request("http://localhost/run", { method: "POST" }),
  });
  if (user instanceof Response) throw new Error("http user did not resolve");
  await attachIntelligenceEnterpriseLearning({ runtime, agent, user });
  return agent;
};

/** One Channel turn: identity comes from the delivery actor, never identifyUser. */
const channelTurn = async (appUserId: string, identifyUser: unknown) => {
  const agent = makeAgent();
  await prepareChannelTurnAgent({
    runtime: makeRuntime(identifyUser),
    agent,
    user: { id: "U-raw", appUserId, name: "Channel Sender" },
    conversationScope: "direct",
    memoryPolicy: "direct-only",
  });
  return agent;
};


beforeEach(() => {
  attachedUserIds.length = 0;
  mcpMiddlewareCalls.length = 0;
});

describe("HTTP and Channel identity isolation (OSS-643, AC #4)", () => {
  it("keeps each path's identity to itself across 10 interleaved pairs", async () => {
    const identifyUser = vi.fn(async () => ({ id: "http-user", name: "HTTP" }));

    // Interleaved, not sequential: an ordering-dependent leak fails reliably
    // rather than flaking green.
    const work: Array<Promise<unknown>> = [];
    for (let i = 0; i < 10; i++) {
      work.push(httpRun(`http-user-${i}`));
      work.push(channelTurn(`slack:T1:U${i}`, identifyUser));
    }
    await Promise.all(work);

    const expected = [
      ...Array.from({ length: 10 }, (_, i) => `http-user-${i}`),
      ...Array.from({ length: 10 }, (_, i) => `slack:T1:U${i}`),
    ].sort();
    expect([...attachedUserIds].sort()).toEqual(expected);

    // Every attachment used exactly one identity — no id appears twice, which
    // is what a leaked shared slot would produce.
    expect(new Set(attachedUserIds).size).toBe(20);
  });

  it("never calls identifyUser on the Channel path", async () => {
    const identifyUser = vi.fn(async () => ({ id: "http-user", name: "HTTP" }));
    await channelTurn("slack:T1:U9", identifyUser);
    expect(identifyUser).not.toHaveBeenCalled();
    expect(attachedUserIds).toEqual(["slack:T1:U9"]);
  });

  it("a Channel turn never picks up the HTTP user, even on the same runtime", async () => {
    const identifyUser = vi.fn(async () => ({
      id: "http-user",
      name: "HTTP",
    }));
    await Promise.all([
      httpRun("http-user"),
      channelTurn("slack:T1:UCHANNEL", identifyUser),
    ]);
    expect(attachedUserIds.sort()).toEqual(["http-user", "slack:T1:UCHANNEL"]);
  });
});

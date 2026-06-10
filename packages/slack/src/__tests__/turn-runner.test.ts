import { describe, it, expect, vi } from "vitest";
import { createTurnRunner } from "../turn-runner.js";
import type { SlackConversationStore } from "../conversation-store.js";
import type { HttpAgent } from "@ag-ui/client";
import { DM_SCOPE, type IncomingTurn } from "../types.js";

function makeFakeClient() {
  const posts: {
    channel: string;
    thread_ts?: string;
    text: string;
    ts: string;
  }[] = [];
  const updates: { channel: string; ts: string; text: string }[] = [];
  let counter = 0;
  const client = {
    chat: {
      postMessage: vi.fn(
        async (args: { channel: string; thread_ts?: string; text: string }) => {
          counter++;
          const ts = `${counter}.0`;
          posts.push({ ...args, ts });
          return { ok: true, ts };
        },
      ),
      update: vi.fn(
        async (args: { channel: string; ts: string; text: string }) => {
          updates.push(args);
          return { ok: true };
        },
      ),
    },
    users: {
      info: vi.fn(async ({ user }: { user: string }) => ({
        ok: true,
        user: {
          id: user,
          real_name: "Alem Tuzlak",
          profile: { display_name: "Alem", email: "alem@copilotkit.ai" },
        },
      })),
    },
  };
  return { client, posts, updates };
}

/**
 * Fake HttpAgent whose `runAgent` is interruptible. It "streams" by
 * letting tests drive its lifecycle: `runAgent` returns a Promise that
 * resolves only when `finish()` is called, or rejects when `abortRun()`
 * is called.
 */
function makeFakeAgent() {
  let resolveRun: (() => void) | undefined;
  let rejectRun: ((err: Error) => void) | undefined;
  let aborted = false;
  const agent = {
    messages: [] as { role: string; content: string }[],
    threadId: "",
    runAgent: vi.fn(async (_p: unknown, subscriber: unknown) => {
      // capture subscriber so the test can fire fake events into it
      // (not used in these tests; kept for symmetry)
      void subscriber;
      return new Promise<void>((resolve, reject) => {
        resolveRun = resolve;
        rejectRun = reject;
      });
    }),
    abortRun: vi.fn(() => {
      aborted = true;
      rejectRun?.(Object.assign(new Error("aborted"), { name: "AbortError" }));
    }),
  };
  return {
    agent: agent as unknown as HttpAgent,
    finishRun: () => resolveRun?.(),
    failRun: (msg: string) => rejectRun?.(new Error(msg)),
    isAborted: () => aborted,
  };
}

function fakeStore(): SlackConversationStore {
  return {
    has: vi.fn(async () => true),
    getOrCreate: vi.fn(async (key, replyTarget, makeAgent) => {
      const threadId = `slack-${key.channelId}-${key.scope}`;
      return { threadId, agent: makeAgent(threadId), replyTarget };
    }),
    save: vi.fn(),
  } as unknown as SlackConversationStore;
}

describe("turn-runner", () => {
  it("interrupt: a second turn for the same conversation aborts the first run", async () => {
    const a = makeFakeAgent();
    const b = makeFakeAgent();
    const agents = [a, b];
    let agentIdx = 0;
    const store = fakeStore();
    (store.getOrCreate as ReturnType<typeof vi.fn>).mockImplementation(
      async (key, replyTarget) => ({
        threadId: `slack-${key.channelId}-${key.scope}`,
        agent: agents[agentIdx++]?.agent,
        replyTarget,
      }),
    );
    const runTurn = createTurnRunner({ store, makeAgent: () => a.agent });
    const fake = makeFakeClient();

    const turn: IncomingTurn = {
      conversation: { channelId: "C1", scope: "100.0" },
      replyTarget: { channel: "C1", threadTs: "100.0" },
      userText: "long question",
    };
    await runTurn(turn, fake.client as never);
    // First agent's runAgent is now pending. Send a second turn.
    await runTurn(
      { ...turn, userText: "actually never mind" },
      fake.client as never,
    );
    // First agent should have been aborted; second is running.
    expect(a.isAborted()).toBe(true);
    expect(b.isAborted()).toBe(false);
    // No `:warning:` posted for the aborted run.
    const warnings = fake.posts.filter((p) => p.text.includes(":warning:"));
    expect(warnings).toHaveLength(0);

    // Tidy: let the second run finish so vitest's open-handle warning is silent.
    b.finishRun();
  });

  it("forwards the requesting Slack user to the agent as context (per-user identity)", async () => {
    const a = makeFakeAgent();
    const store = fakeStore();
    (store.getOrCreate as ReturnType<typeof vi.fn>).mockImplementation(
      async (key, replyTarget) => ({
        threadId: "x",
        agent: a.agent,
        replyTarget,
      }),
    );
    const runTurn = createTurnRunner({
      store,
      makeAgent: () => a.agent,
      context: [{ description: "App", value: "static app context" }],
    });
    const fake = makeFakeClient();

    await runTurn(
      {
        conversation: { channelId: "C1", scope: "100.0" },
        replyTarget: { channel: "C1", threadTs: "100.0" },
        userText: "what are my issues?",
        senderUserId: "U_ALEM",
      },
      fake.client as never,
    );

    const firstArg = (a.agent.runAgent as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as {
      context: Array<{ description: string; value: string }>;
    };
    const sender = firstArg.context.find(
      (e) => e.description === "Requesting Slack user",
    );
    expect(sender).toBeDefined();
    expect(sender?.value).toContain("<@U_ALEM>");
    // The bridge resolves the sender's profile and bakes the email into the
    // context so the agent can match them to Linear/Notion without a lookup.
    expect(sender?.value).toContain("alem@copilotkit.ai");
    // The static app context is still forwarded alongside it.
    expect(firstArg.context.some((e) => e.description === "App")).toBe(true);

    a.finishRun();
  });

  it("omits the requesting-user context entry when no sender id is present", async () => {
    const a = makeFakeAgent();
    const store = fakeStore();
    (store.getOrCreate as ReturnType<typeof vi.fn>).mockImplementation(
      async (key, replyTarget) => ({
        threadId: "x",
        agent: a.agent,
        replyTarget,
      }),
    );
    const runTurn = createTurnRunner({ store, makeAgent: () => a.agent });
    const fake = makeFakeClient();

    await runTurn(
      {
        conversation: { channelId: "C1", scope: "100.0" },
        replyTarget: { channel: "C1", threadTs: "100.0" },
        userText: "hi",
      },
      fake.client as never,
    );

    const firstArg = (a.agent.runAgent as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as { context: Array<{ description: string }> };
    expect(
      firstArg.context.some((e) => e.description === "Requesting Slack user"),
    ).toBe(false);

    a.finishRun();
  });

  it("interrupt: real (non-abort) errors still surface as :warning:", async () => {
    const a = makeFakeAgent();
    const store = fakeStore();
    (store.getOrCreate as ReturnType<typeof vi.fn>).mockImplementation(
      async (key, replyTarget) => ({
        threadId: "x",
        agent: a.agent,
        replyTarget,
      }),
    );
    const runTurn = createTurnRunner({ store, makeAgent: () => a.agent });
    const fake = makeFakeClient();
    const turn: IncomingTurn = {
      conversation: { channelId: "C1", scope: "100.0" },
      replyTarget: { channel: "C1", threadTs: "100.0" },
      userText: "hi",
    };
    await runTurn(turn, fake.client as never);
    a.failRun("boom");
    // Give the IIFE microtask a tick to settle.
    await new Promise((r) => setTimeout(r, 5));
    const warnings = fake.posts.filter((p) => p.text.includes(":warning:"));
    expect(warnings.length).toBe(1);
    expect(warnings[0]!.text).toContain("boom");
  });

  it("interrupt: two distinct conversations don't interfere with each other", async () => {
    const a = makeFakeAgent();
    const b = makeFakeAgent();
    const agents = [a, b];
    let i = 0;
    const store = fakeStore();
    (store.getOrCreate as ReturnType<typeof vi.fn>).mockImplementation(
      async (key, replyTarget) => ({
        threadId: `slack-${key.channelId}-${key.scope}`,
        agent: agents[i++]?.agent,
        replyTarget,
      }),
    );
    const runTurn = createTurnRunner({ store, makeAgent: () => a.agent });
    const fake = makeFakeClient();
    await runTurn(
      {
        conversation: { channelId: "C1", scope: "100.0" },
        replyTarget: { channel: "C1", threadTs: "100.0" },
        userText: "first",
      },
      fake.client as never,
    );
    await runTurn(
      {
        conversation: { channelId: "C2", scope: "200.0" }, // DIFFERENT conv
        replyTarget: { channel: "C2", threadTs: "200.0" },
        userText: "second",
      },
      fake.client as never,
    );
    expect(a.isAborted()).toBe(false);
    expect(b.isAborted()).toBe(false);
    a.finishRun();
    b.finishRun();
  });

  it("uses the threadId derived by the store for each distinct conversation", async () => {
    const seenThreadIds: string[] = [];
    const store = fakeStore();
    const runTurn = createTurnRunner({
      store,
      makeAgent: (threadId) => {
        seenThreadIds.push(threadId);
        return makeFakeAgent().agent;
      },
    });
    const fake = makeFakeClient();
    const turns: IncomingTurn[] = [
      {
        conversation: { channelId: "C1", scope: "100.0" },
        replyTarget: { channel: "C1", threadTs: "100.0" },
        userText: "a",
      },
      {
        conversation: { channelId: "C2", scope: "100.0" },
        replyTarget: { channel: "C2", threadTs: "100.0" },
        userText: "b",
      },
      {
        conversation: { channelId: "D1", scope: DM_SCOPE },
        replyTarget: { channel: "D1" },
        userText: "c",
      },
    ];
    for (const t of turns) await runTurn(t, fake.client as never);
    expect(new Set(seenThreadIds).size).toBe(3);
  });
});

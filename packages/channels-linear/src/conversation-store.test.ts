import { beforeEach, describe, expect, it } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import type {
  LinearApiClient,
  LinearSession,
  LinearSessionActivity,
} from "./client.js";
import { LinearConversationStore } from "./conversation-store.js";
import type { ReplyTarget } from "./types.js";

const target: ReplyTarget = {
  organizationId: "org-1",
  agentSessionId: "sess-1",
};

const issue = {
  id: "issue-1",
  identifier: "ENG-42",
  title: "Login fails on Safari",
  description: "Users see a blank page.",
  url: "https://linear.app/acme/issue/ENG-42",
};

const { description: _description, ...issueWithoutDescription } = issue;

let clock = 0;
function activity(
  content: LinearSessionActivity["content"],
  extra: Partial<LinearSessionActivity> = {},
): LinearSessionActivity {
  clock += 1;
  return {
    id: `act-${clock}`,
    createdAt: `2026-11-10T10:00:${String(clock).padStart(2, "0")}.000Z`,
    userId: content.type === "prompt" ? "user-1" : "app-user",
    content,
    ...extra,
  };
}

/** Store over a fake Linear client that always returns `session`. */
function storeFor(session: Omit<LinearSession, "id">, maxMessages?: number) {
  const client: Pick<LinearApiClient, "getSession"> = {
    async getSession(id) {
      return { id, ...session };
    },
  };
  return new LinearConversationStore({ client, maxMessages });
}

function makeAgent(threadId: string) {
  return new HttpAgent({ url: "http://agent.test", threadId });
}

/** Open a turn and return the session plus the real HttpAgent the store got. */
async function openSession(store: LinearConversationStore) {
  const agents: HttpAgent[] = [];
  const session = await store.getOrCreate(
    "linear:sess-1",
    target,
    (threadId) => {
      const agent = makeAgent(threadId);
      agents.push(agent);
      return agent;
    },
  );
  return { session, agent: agents[0]! };
}

describe("LinearConversationStore", () => {
  beforeEach(() => {
    clock = 0;
  });

  it("rebuilds the agent's messages from the session: issue context, prompts, responses, elicitations", async () => {
    const store = storeFor({
      issue,
      activities: [
        activity({ type: "prompt", body: "Why does login fail?" }),
        activity(
          { type: "thought", body: "Reading the issue" },
          { id: "thought" },
        ),
        activity({ type: "action", action: "search", parameter: "safari" }),
        activity({ type: "response", body: "It is a CSP header." }),
        activity({ type: "elicitation", body: "Open a PR?" }),
        activity({ type: "prompt", body: "Stop" }, { signal: "stop" }),
        activity({ type: "error", body: "Run stopped" }),
        activity({ type: "prompt", body: "Yes" }, { id: "last-prompt" }),
      ],
    });

    const session = await store.getOrCreate("linear:sess-1", target, makeAgent);

    expect(session.agent.messages).toEqual([
      {
        id: "linear-issue-issue-1",
        role: "user",
        content:
          "Linear issue ENG-42: Login fails on Safari\n" +
          "URL: https://linear.app/acme/issue/ENG-42\n\n" +
          "Users see a blank page.",
      },
      { id: "act-1", role: "user", content: "Why does login fail?" },
      { id: "act-4", role: "assistant", content: "It is a CSP header." },
      { id: "act-5", role: "assistant", content: "Open a PR?" },
      { id: "last-prompt", role: "user", content: "Yes" },
    ]);
  });

  it("starts each turn on a fresh thread id for the session", async () => {
    const store = storeFor({ activities: [] });

    const first = await store.getOrCreate("linear:sess-1", target, makeAgent);
    const second = await store.getOrCreate("linear:sess-1", target, makeAgent);

    expect(first.agent.threadId).toMatch(/^linear-sess-1-[0-9a-f-]{36}$/);
    expect(second.agent.threadId).toMatch(/^linear-sess-1-[0-9a-f-]{36}$/);
    expect(first.agent.threadId).not.toBe(second.agent.threadId);
  });

  it("keeps only the newest messages, with the issue context still first", async () => {
    const store = storeFor(
      {
        issue: issueWithoutDescription,
        activities: [
          activity({ type: "prompt", body: "one" }),
          activity({ type: "response", body: "two" }),
          activity({ type: "prompt", body: "three" }),
        ],
      },
      2,
    );

    const session = await store.getOrCreate("linear:sess-1", target, makeAgent);

    expect(session.agent.messages).toEqual([
      {
        id: "linear-issue-issue-1",
        role: "user",
        content:
          "Linear issue ENG-42: Login fails on Safari\n" +
          "URL: https://linear.app/acme/issue/ENG-42",
      },
      { id: "act-2", role: "assistant", content: "two" },
      { id: "act-3", role: "user", content: "three" },
    ]);
  });

  it("adds no issue context when the session has no issue", async () => {
    const store = storeFor({
      activities: [activity({ type: "prompt", body: "hello" })],
    });

    const session = await store.getOrCreate("linear:sess-1", target, makeAgent);

    expect(session.agent.messages).toEqual([
      { id: "act-1", role: "user", content: "hello" },
    ]);
  });

  it("appends a primed prompt once when the session has no prompt yet", async () => {
    const store = storeFor({
      issue: issueWithoutDescription,
      activities: [activity({ type: "thought", body: "Looking into this" })],
    });
    store.primeSession("sess-1", "Please fix the Safari login.");

    const first = await store.getOrCreate("linear:sess-1", target, makeAgent);
    const second = await store.getOrCreate("linear:sess-1", target, makeAgent);

    expect(first.agent.messages).toEqual([
      {
        id: "linear-issue-issue-1",
        role: "user",
        content:
          "Linear issue ENG-42: Login fails on Safari\n" +
          "URL: https://linear.app/acme/issue/ENG-42",
      },
      {
        id: "linear-prompt-sess-1",
        role: "user",
        content: "Please fix the Safari login.",
      },
    ]);
    expect(second.agent.messages).toEqual([
      {
        id: "linear-issue-issue-1",
        role: "user",
        content:
          "Linear issue ENG-42: Login fails on Safari\n" +
          "URL: https://linear.app/acme/issue/ENG-42",
      },
    ]);
  });

  it("drops a primed prompt when the session already has a prompt activity", async () => {
    const store = storeFor({
      activities: [activity({ type: "prompt", body: "Fix login" })],
    });
    store.primeSession("sess-1", "Please fix the Safari login.");

    const session = await store.getOrCreate("linear:sess-1", target, makeAgent);

    expect(session.agent.messages).toEqual([
      { id: "act-1", role: "user", content: "Fix login" },
    ]);
  });

  it("abortSession aborts the live agent, and release() forgets it", async () => {
    const store = storeFor({ activities: [] });
    const { session, agent } = await openSession(store);

    expect(store.abortSession("sess-1")).toBe(true);
    expect(agent.abortController.signal.aborted).toBe(true);

    await session.release?.();
    expect(store.abortSession("sess-1")).toBe(false);
  });

  it("returns false from abortSession for a session with no live agent", () => {
    const store = storeFor({ activities: [] });

    expect(store.abortSession("sess-unknown")).toBe(false);
  });

  it("does not forget a newer turn's agent when an older turn releases", async () => {
    const store = storeFor({ activities: [] });
    const older = await openSession(store);
    const newer = await openSession(store);

    await older.session.release?.();

    expect(store.abortSession("sess-1")).toBe(true);
    expect(newer.agent.abortController.signal.aborted).toBe(true);
    expect(older.agent.abortController.signal.aborted).toBe(false);
  });

  it("getMessages returns the conversation turns as thread messages", async () => {
    const store = storeFor({
      issue,
      activities: [
        activity({ type: "prompt", body: "Why does login fail?" }),
        activity({ type: "thought", body: "Reading" }),
        activity({ type: "response", body: "It is a CSP header." }),
      ],
    });

    const messages = await store.getMessages(target);

    expect(messages).toEqual([
      {
        text: "Why does login fail?",
        isBot: false,
        ts: "2026-11-10T10:00:01.000Z",
      },
      {
        text: "It is a CSP header.",
        isBot: true,
        ts: "2026-11-10T10:00:03.000Z",
      },
    ]);
  });
});

import { FakeAgent } from "@copilotkit/channels-core";
import { describe, expect, it } from "vitest";
import { StaticTokenProvider } from "./app-auth.js";
import { GitHubApiClient } from "./client.js";
import { GitHubConversationStore } from "./conversation-store.js";
import type { GitHubComment, ReplyTarget } from "./types.js";

const API = "https://api.github.test";
const BOT_LOGIN = "ck-bot[bot]";
const ISSUE_TARGET: ReplyTarget = {
  owner: "acme",
  repo: "widgets",
  issueNumber: 7,
};
const REVIEW_TARGET: ReplyTarget = { ...ISSUE_TARGET, reviewCommentId: 10 };

function createComment(
  id: number,
  login: string,
  body: string,
  extra: Partial<GitHubComment> = {},
): GitHubComment {
  return {
    id,
    body,
    user: { login, id: id * 10, type: login === BOT_LOGIN ? "Bot" : "User" },
    html_url: `https://github.test/acme/widgets/issues/7#issuecomment-${id}`,
    created_at: `2026-11-10T10:00:${String(id).padStart(2, "0")}Z`,
    ...extra,
  };
}

/** A store over a fake GitHub that answers list calls by path. */
function createStore(
  responses: {
    issueComments?: GitHubComment[];
    reviewComments?: GitHubComment[];
  },
  options: { maxMessages?: number } = {},
) {
  const paths: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    const isReviewList = path === "/repos/acme/widgets/pulls/7/comments";
    return Response.json(
      isReviewList
        ? (responses.reviewComments ?? [])
        : (responses.issueComments ?? []),
    );
  };
  const client = new GitHubApiClient({
    auth: new StaticTokenProvider("ghp_test"),
    apiBaseUrl: API,
    fetch: fetchImpl,
  });
  const store = new GitHubConversationStore({
    client,
    botLogin: async () => BOT_LOGIN,
    maxMessages: options.maxMessages,
  });
  return { store, paths };
}

function makeAgent(threadId: string) {
  const agent = new FakeAgent();
  agent.threadId = threadId;
  return agent;
}

describe("GitHubConversationStore.getOrCreate", () => {
  it("seeds the inbound turn", () => {
    const { store } = createStore({});
    expect(store.seedsInboundTurn).toBe(true);
  });

  it("maps bot comments to assistant and other comments to user, stripping the bot mention and skipping empty bodies", async () => {
    const { store } = createStore({
      issueComments: [
        createComment(1, "octocat", "@ck-bot what does parse() do?"),
        createComment(2, BOT_LOGIN, "It parses the config.\n"),
        createComment(3, "hubot", "   "),
        createComment(4, "octocat", "@ck-bot"),
        createComment(5, "octocat", "Thanks @CK-Bot[bot], and @ck-bot-two too"),
      ],
    });

    const { agent } = await store.getOrCreate(
      "github:acme/widgets#7",
      ISSUE_TARGET,
      makeAgent,
    );

    expect(agent.messages).toEqual([
      {
        id: "github-comment-1",
        role: "user",
        content: "what does parse() do?",
      },
      {
        id: "github-comment-2",
        role: "assistant",
        content: "It parses the config.",
      },
      {
        id: "github-comment-5",
        role: "user",
        content: "Thanks and @ck-bot-two too",
      },
    ]);
  });

  it("gives every turn a fresh thread id for the issue", async () => {
    const { store } = createStore({});

    const first = await store.getOrCreate("k", ISSUE_TARGET, makeAgent);
    const second = await store.getOrCreate("k", ISSUE_TARGET, makeAgent);

    expect(first.threadId).toMatch(/^github-acme-widgets-7-[0-9a-f-]{36}$/);
    expect(first.agent.threadId).toBe(first.threadId);
    expect(second.threadId).not.toBe(first.threadId);
  });

  it("reads only the review thread when the target has a reviewCommentId", async () => {
    const { store, paths } = createStore({
      reviewComments: [
        createComment(10, "octocat", "@ck-bot is this safe?"),
        createComment(11, "octocat", "unrelated thread"),
        createComment(12, BOT_LOGIN, "Yes.", { in_reply_to_id: 10 }),
      ],
    });

    const { agent } = await store.getOrCreate("k", REVIEW_TARGET, makeAgent);

    expect(paths).toEqual(["/repos/acme/widgets/pulls/7/comments"]);
    expect(agent.messages).toEqual([
      { id: "github-comment-10", role: "user", content: "is this safe?" },
      { id: "github-comment-12", role: "assistant", content: "Yes." },
    ]);
  });

  it("keeps only the newest maxMessages messages", async () => {
    const { store } = createStore(
      {
        issueComments: [
          createComment(1, "octocat", "one"),
          createComment(2, BOT_LOGIN, "two"),
          createComment(3, "octocat", "three"),
        ],
      },
      { maxMessages: 2 },
    );

    const { agent } = await store.getOrCreate("k", ISSUE_TARGET, makeAgent);

    expect(agent.messages.map((message) => message.content)).toEqual([
      "two",
      "three",
    ]);
  });
});

describe("GitHubConversationStore.getMessages", () => {
  it("returns the conversation as thread messages with bot flag and timestamp", async () => {
    const { store } = createStore({
      issueComments: [
        createComment(1, "octocat", "@ck-bot hi"),
        createComment(2, BOT_LOGIN, "Hello!"),
      ],
    });

    const messages = await store.getMessages(ISSUE_TARGET);

    expect(messages).toEqual([
      { text: "hi", isBot: false, ts: "2026-11-10T10:00:01Z" },
      { text: "Hello!", isBot: true, ts: "2026-11-10T10:00:02Z" },
    ]);
  });
});

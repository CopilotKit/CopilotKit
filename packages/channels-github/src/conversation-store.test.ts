import { FakeAgent } from "@copilotkit/channels-core";
import { describe, expect, it } from "vitest";
import { StaticTokenProvider } from "./app-auth.js";
import { withBotMarker } from "./bot-marker.js";
import { GitHubApiClient } from "./client.js";
import { GitHubConversationStore } from "./conversation-store.js";
import type { GitHubComment, GitHubIssue, ReplyTarget } from "./types.js";

const API = "https://api.github.test";
const BOT_LOGIN = "ck-bot[bot]";
const ISSUE_TARGET: ReplyTarget = {
  owner: "acme",
  repo: "widgets",
  issueNumber: 7,
};
const REVIEW_TARGET: ReplyTarget = { ...ISSUE_TARGET, reviewCommentId: 10 };
const ISSUE: GitHubIssue = {
  number: 7,
  title: "Config parse fails on empty files",
  body: "Steps: run `widgets --config empty.yml`.",
  html_url: "https://github.test/acme/widgets/issues/7",
};

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
    issue?: GitHubIssue;
    issueComments?: GitHubComment[];
    reviewComments?: GitHubComment[];
  },
  options: { maxMessages?: number; botLogin?: string } = {},
) {
  const paths: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path === "/repos/acme/widgets/issues/7") {
      return Response.json(responses.issue ?? ISSUE);
    }
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
    botLogin: async () => options.botLogin ?? BOT_LOGIN,
    botUsername: "ck-bot",
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

    expect(agent.messages.slice(1)).toEqual([
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

    expect(paths).not.toContain("/repos/acme/widgets/issues/7/comments");
    expect(agent.messages.slice(1)).toEqual([
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

    expect(agent.messages.slice(1).map((message) => message.content)).toEqual([
      "two",
      "three",
    ]);
  });

  it("starts the history with the issue title, URL and description", async () => {
    const { store } = createStore({});

    const { agent } = await store.getOrCreate("k", ISSUE_TARGET, makeAgent);

    expect(agent.messages).toEqual([
      {
        id: "github-context-acme-widgets-7",
        role: "user",
        content: [
          "Context from GitHub for this conversation:",
          "Issue #7 in acme/widgets: Config parse fails on empty files",
          "https://github.test/acme/widgets/issues/7",
          "Description:\nSteps: run `widgets --config empty.yml`.",
        ].join("\n\n"),
      },
    ]);
  });

  it("adds the file, line and diff hunk of a review thread to the context", async () => {
    const { store } = createStore({
      issue: { ...ISSUE, title: "Retry uploads", body: null, pull_request: {} },
      reviewComments: [
        createComment(10, "octocat", "@ck-bot is this safe?", {
          path: "src/upload.ts",
          line: 42,
          diff_hunk: "@@ -40,2 +40,3 @@\n retry();\n+retry();",
        }),
      ],
    });

    const { agent } = await store.getOrCreate("k", REVIEW_TARGET, makeAgent);

    expect(agent.messages[0]?.content).toBe(
      [
        "Context from GitHub for this conversation:",
        "Pull request #7 in acme/widgets: Retry uploads",
        "https://github.test/acme/widgets/issues/7",
        "Description:\n(no description)",
        "This review thread is on `src/upload.ts`, line 42.",
        "The diff up to that line:\n```diff\n@@ -40,2 +40,3 @@\n retry();\n+retry();\n```",
      ].join("\n\n"),
    );
  });

  it("with a person's own token, keeps their comments as user messages and only marked comments as the bot's", async () => {
    const { store } = createStore(
      {
        issueComments: [
          createComment(1, "octocat", "@ck-bot what does parse() do?"),
          createComment(2, "octocat", withBotMarker("It parses the config.")),
          createComment(3, "someone", withBotMarker("I copied the marker")),
        ],
      },
      { botLogin: "octocat" },
    );

    const { agent } = await store.getOrCreate("k", ISSUE_TARGET, makeAgent);

    expect(agent.messages.slice(1)).toEqual([
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
        id: "github-comment-3",
        role: "user",
        content: withBotMarker("I copied the marker"),
      },
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

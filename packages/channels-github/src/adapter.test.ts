import { createHmac } from "node:crypto";
import { EventType } from "@ag-ui/client";
import type { AgentSubscriber, RunAgentInput } from "@ag-ui/client";
import {
  createChannel,
  FakeAgent,
  MemoryStore,
} from "@copilotkit/channels-core";
import type { Channel, ChannelHandler } from "@copilotkit/channels-core";
import { Actions, Button } from "@copilotkit/channels-ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOT_MARKER_LENGTH,
  hasBotMarker,
  withBotMarker,
} from "./bot-marker.js";
import { github } from "./adapter.js";
import type {
  GitHubComment,
  GitHubUser,
  IssueCommentEvent,
  PullRequestReviewCommentEvent,
} from "./types.js";

/** A request body with the hidden bot marker removed from its `body` text. */
function withoutMarker<T extends { body?: string }>(payload: T): T {
  if (payload.body === undefined || !hasBotMarker(payload.body)) {
    return payload;
  }
  return { ...payload, body: payload.body.slice(0, -BOT_MARKER_LENGTH) };
}

/**
 * End to end: signed webhook deliveries go through `adapter.handleWebhook`
 * into a real `createChannel`, and the agent's output reaches a fake GitHub
 * REST API behind the adapter's injectable `fetch`.
 */

const API = "https://api.github.test";
const SECRET = "webhook-secret";
const BOT = "acme-helper";
const REACTION_ID = 900;
const CREATED_AT = "2026-11-10T09:15:00Z";
const OCTOCAT: GitHubUser = { login: "octocat", id: 583231, type: "User" };
const REPOSITORY = { name: "widgets", owner: { login: "acme" } };

interface RecordedRequest {
  method: string;
  path: string;
  body?: { body?: string; content?: string };
}

/**
 * In-memory GitHub behind a fake `fetch`. Records every request, gives each
 * created comment a fresh id, and keeps its current body.
 */
function createFakeGitHub() {
  const requests: RecordedRequest[] = [];
  const bodies = new Map<number, string>();
  let nextId = 100;

  const comment = (id: number, body: string): GitHubComment => ({
    id,
    body,
    user: { login: BOT, id: 9001, type: "User" },
    html_url: `https://github.test/acme/widgets/issues/42#issuecomment-${id}`,
    created_at: CREATED_AT,
  });

  const fetchImpl: typeof fetch = async (input, init) => {
    const request: RecordedRequest = {
      method: init?.method ?? "GET",
      path: new URL(String(input)).pathname,
      // Record the text the code under test wrote, without the client's marker.
      body:
        typeof init?.body === "string"
          ? withoutMarker(JSON.parse(init.body))
          : undefined,
    };
    requests.push(request);

    if (request.method === "GET" && request.path === "/user") {
      return Response.json({ login: BOT });
    }
    if (
      request.method === "GET" &&
      /^\/repos\/acme\/widgets\/issues\/\d+$/.test(request.path)
    ) {
      return Response.json({
        number: 42,
        title: "Deploys are flaky",
        body: null,
        html_url: "https://github.test/acme/widgets/issues/42",
      });
    }
    if (request.method === "GET") return Response.json([]);
    if (request.method === "POST" && request.path.endsWith("/reactions")) {
      return Response.json({ id: REACTION_ID }, { status: 201 });
    }
    const text = request.body?.body ?? "";
    if (request.method === "POST") {
      const id = nextId++;
      bodies.set(id, text);
      return Response.json(comment(id, text), { status: 201 });
    }
    if (request.method === "PATCH") {
      const id = Number(request.path.split("/").at(-1));
      bodies.set(id, text);
      return Response.json(comment(id, text));
    }
    return new Response(null, { status: 204 });
  };

  /** Writes as `"METHOD /path payload"`, where payload is the body or reaction content. */
  const writes = () =>
    requests
      .filter((request) => request.method !== "GET")
      .map((request) => {
        const payload = request.body?.body ?? request.body?.content;
        const line = `${request.method} ${request.path}`;
        return payload === undefined ? line : `${line} ${payload}`;
      });

  return { fetch: fetchImpl, requests, bodies, writes };
}

const RUN_INPUT: RunAgentInput = {
  threadId: "thread-1",
  runId: "run-1",
  state: {},
  messages: [],
  tools: [],
  context: [],
  forwardedProps: {},
};

/** An agent run that streams `deltas` as one text message, the way `@ag-ui/client` calls a subscriber. */
function streamText(
  deltas: string[],
  afterEachDelta: () => Promise<void> = async () => {},
) {
  return async (subscriber: AgentSubscriber) => {
    const params = {
      messages: [],
      state: {},
      agent: new FakeAgent(),
      input: RUN_INPUT,
    };
    const messageId = "m1";
    await subscriber.onTextMessageStartEvent?.({
      ...params,
      event: { type: EventType.TEXT_MESSAGE_START, messageId },
    });
    for (const delta of deltas) {
      await subscriber.onTextMessageContentEvent?.({
        ...params,
        event: { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta },
        textMessageBuffer: "",
      });
      await afterEachDelta();
    }
    await subscriber.onTextMessageEndEvent?.({
      ...params,
      event: { type: EventType.TEXT_MESSAGE_END, messageId },
      textMessageBuffer: "",
    });
  };
}

function sign(body: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

let deliverySeq = 0;

/** A signed webhook POST, as GitHub sends it. */
function webhookRequest(
  name: string,
  payload: IssueCommentEvent | PullRequestReviewCommentEvent,
  secret = SECRET,
) {
  const body = JSON.stringify(payload);
  return new Request("http://localhost/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": name,
      "x-github-delivery": `delivery-${++deliverySeq}`,
      "x-hub-signature-256": sign(body, secret),
    },
    body,
  });
}

/** `issue_comment.created` on issue #42. */
function issueComment(
  init: { id: number; body: string; user?: GitHubUser },
  secret?: string,
) {
  const user = init.user ?? OCTOCAT;
  const payload: IssueCommentEvent = {
    action: "created",
    issue: { number: 42 },
    comment: {
      id: init.id,
      body: init.body,
      user,
      html_url: `https://github.test/acme/widgets/issues/42#issuecomment-${init.id}`,
      created_at: CREATED_AT,
    },
    repository: REPOSITORY,
    sender: user,
  };
  return webhookRequest("issue_comment", payload, secret);
}

/** `pull_request_review_comment.created` on PR #7, replying in the thread rooted at `inReplyToId`. */
function reviewComment(init: {
  id: number;
  inReplyToId: number;
  body: string;
}) {
  const payload: PullRequestReviewCommentEvent = {
    action: "created",
    pull_request: { number: 7 },
    comment: {
      id: init.id,
      body: init.body,
      user: OCTOCAT,
      html_url: `https://github.test/acme/widgets/pull/7#discussion_r${init.id}`,
      in_reply_to_id: init.inReplyToId,
      created_at: CREATED_AT,
    },
    repository: REPOSITORY,
    sender: OCTOCAT,
  };
  return webhookRequest("pull_request_review_comment", payload);
}

const activeChannels: Channel[] = [];

/** An `onMention` handler that runs the agent on the turn. */
const runAgent: ChannelHandler = async ({ thread }) => {
  await thread.runAgent();
};

type AgentScript = ConstructorParameters<typeof FakeAgent>[0];

/** A started channel on a token-mode GitHub adapter, with `onMention` set to `handler`. */
async function setup(
  handler: ChannelHandler,
  agentScript: AgentScript = [],
  fakeGitHub = createFakeGitHub(),
  stateStore = new MemoryStore(),
) {
  const adapter = github({
    token: "ghp_test",
    webhookSecret: SECRET,
    botUsername: BOT,
    apiBaseUrl: API,
    fetch: fakeGitHub.fetch,
    stateStore,
  });
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
    agent: new FakeAgent(agentScript),
  });
  channel.onMention(handler);
  await channel.ɵruntime.start();
  activeChannels.push(channel);
  return { adapter, fakeGitHub };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  while (activeChannels.length > 0) {
    await activeChannels.pop()?.ɵruntime.stop();
  }
});

describe("github() adapter end to end", () => {
  it("answers a mention with an eyes reaction and a streamed reply comment, then removes the reaction", async () => {
    const fakeGitHub = createFakeGitHub();
    // Hold the second delta until the first one created the reply comment.
    const replyCreated = () =>
      vi.waitFor(() => expect(fakeGitHub.bodies.get(100)).toBeDefined());
    const { adapter } = await setup(
      runAgent,
      [streamText(["Hello", " world"], replyCreated)],
      fakeGitHub,
    );

    const response = await adapter.handleWebhook(
      issueComment({ id: 2468013579, body: "@acme-helper say hello" }),
    );
    expect(response.status).toBe(200);

    const reaction = "/repos/acme/widgets/issues/comments/2468013579/reactions";
    await vi.waitFor(() =>
      expect(fakeGitHub.writes()).toContain(
        `DELETE ${reaction}/${REACTION_ID}`,
      ),
    );
    const writes = fakeGitHub.writes();
    expect(writes.filter((line) => line.includes(reaction))).toEqual([
      `POST ${reaction} eyes`,
      `DELETE ${reaction}/${REACTION_ID}`,
    ]);
    expect(writes.filter((line) => !line.includes(reaction))).toEqual([
      "POST /repos/acme/widgets/issues/42/comments Hello",
      "PATCH /repos/acme/widgets/issues/comments/100 Hello world",
    ]);
  });

  it("posts awaitChoice buttons as a numbered comment and resolves with the value a plain numbered reply picks", async () => {
    let chosen: unknown;
    const { adapter, fakeGitHub } = await setup(async ({ thread }) => {
      chosen = await thread.awaitChoice(
        Actions({
          children: [
            Button({ value: "deploy", children: "Deploy" }),
            Button({ value: "cancel", children: "Cancel" }),
          ],
        }),
      );
    });

    await adapter.handleWebhook(
      issueComment({ id: 3001, body: "@acme-helper ship it?" }),
    );
    await vi.waitFor(() =>
      expect(fakeGitHub.writes()).toEqual([
        "POST /repos/acme/widgets/issues/42/comments Reply with a number:\n\n1. Deploy\n2. Cancel",
      ]),
    );

    await adapter.handleWebhook(issueComment({ id: 3002, body: "2" }));
    await vi.waitFor(() => expect(chosen).toBe("cancel"));
  });

  it("replies to a review comment mention inside its review thread", async () => {
    const { adapter, fakeGitHub } = await setup(runAgent, [
      streamText(["Looks fine"]),
    ]);

    await adapter.handleWebhook(
      reviewComment({ id: 2222, inReplyToId: 1111, body: "@acme-helper ok?" }),
    );

    await vi.waitFor(() =>
      expect(fakeGitHub.writes()).toContain(
        "POST /repos/acme/widgets/pulls/7/comments/1111/replies Looks fine",
      ),
    );
  });

  it("rejects a delivery with a bad signature and never runs the handler", async () => {
    const texts: string[] = [];
    const { adapter } = await setup(({ message }) => {
      texts.push(message.text);
    });

    const rejected = await adapter.handleWebhook(
      issueComment({ id: 4001, body: "@acme-helper forged" }, "wrong-secret"),
    );
    await adapter.handleWebhook(
      issueComment({ id: 4002, body: "@acme-helper genuine" }),
    );

    expect(rejected.status).toBe(401);
    await vi.waitFor(() => expect(texts).toEqual(["genuine"]));
  });

  it("ignores the bot's own comment even when it mentions the bot", async () => {
    const texts: string[] = [];
    const { adapter } = await setup(({ message }) => {
      texts.push(message.text);
    });

    await adapter.handleWebhook(
      issueComment({
        id: 5001,
        body: withBotMarker("@acme-helper see above"),
        user: { login: BOT, id: 9001, type: "User" },
      }),
    );
    await adapter.handleWebhook(
      issueComment({ id: 5002, body: "@acme-helper real question" }),
    );

    await vi.waitFor(() => expect(texts).toEqual(["real question"]));
  });

  it("answers the token owner's own comments when the token is a person's own", async () => {
    const texts: string[] = [];
    const { adapter } = await setup(({ message }) => {
      texts.push(message.text);
    });

    await adapter.handleWebhook(
      issueComment({
        id: 5003,
        body: "@acme-helper summarize this issue",
        user: { login: BOT, id: 9001, type: "User" },
      }),
    );

    await vi.waitFor(() => expect(texts).toEqual(["summarize this issue"]));
  });

  it("answers 500 when the delivery's state cannot be read, and runs the turn when the delivery is sent again", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const stateStore = new MemoryStore();
    vi.spyOn(stateStore.kv, "get").mockRejectedValueOnce(
      new Error("store down"),
    );
    const texts: string[] = [];
    const { adapter } = await setup(
      ({ message }) => {
        texts.push(message.text);
      },
      [],
      createFakeGitHub(),
      stateStore,
    );
    const request = issueComment({ id: 6001, body: "@acme-helper retry me" });

    const failed = await adapter.handleWebhook(request.clone());
    expect(failed.status).toBe(500);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(texts).toEqual([]);

    const redelivered = await adapter.handleWebhook(request);
    expect(redelivered.status).toBe(200);
    await vi.waitFor(() => expect(texts).toEqual(["retry me"]));
  });
});

import { createHmac } from "node:crypto";
import { EventType } from "@ag-ui/client";
import type { AgentSubscriber, RunAgentInput } from "@ag-ui/client";
import { createChannel, FakeAgent } from "@copilotkit/channels-core";
import type { Channel, ChannelHandler } from "@copilotkit/channels-core";
import { Actions, Button } from "@copilotkit/channels-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { notion } from "./adapter.js";
import type { NotionAdapter } from "./adapter.js";
import { richTextToPlainText } from "./render/rich-text.js";
import type {
  NotionComment,
  NotionWebhookEvent,
  RichTextItem,
} from "./types.js";

/**
 * End to end: a signed webhook POST goes through `adapter.handleWebhook`, the
 * real ingress, the channel engine, and a scripted agent. Only Notion's REST
 * API (an in-memory comment list behind a fake `fetch`) and the agent backend
 * are faked.
 */

const BOT_ID = "bot-1";
const USER_ID = "user-1";
const PAGE_ID = "page-1";
const VERIFICATION_TOKEN = "secret_verification";
const API_BASE_URL = "https://notion.test";

const tick = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

function text(content: string): RichTextItem {
  return { type: "text", text: { content }, plain_text: content };
}

function botMention(): RichTextItem {
  return {
    type: "mention",
    mention: { type: "user", user: { object: "user", id: BOT_ID } },
    plain_text: "@Acme Bot",
  };
}

interface CommentBody {
  discussion_id?: string;
  rich_text?: RichTextItem[];
}

/** In-memory Notion comments API behind a `fetch`. Logs every bot write. */
function createFakeNotion() {
  const comments: NotionComment[] = [];
  /** Bot writes, as "create <id> <text>", "update <id> <text>", "delete <id>". */
  const writes: string[] = [];
  /** Every request, as "<METHOD> <path>". */
  const requests: string[] = [];
  let commentSeq = 0;
  let commentReadsDown = 0;

  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const notFound = () =>
    json({ object: "error", code: "object_not_found", message: "nope" }, 404);

  const addComment = (
    discussionId: string,
    richText: RichTextItem[],
    authorId: string,
  ) => {
    commentSeq += 1;
    const comment: NotionComment = {
      object: "comment",
      id: `c${commentSeq}`,
      discussion_id: discussionId,
      parent: { type: "page_id", page_id: PAGE_ID },
      created_by: { object: "user", id: authorId },
      created_time: `2026-11-10T09:00:${String(commentSeq).padStart(2, "0")}.000Z`,
      rich_text: richText,
    };
    comments.push(comment);
    return comment;
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url.pathname}`);
    const body: CommentBody =
      typeof init?.body === "string" ? JSON.parse(init.body) : {};
    const commentId = url.pathname.split("/")[3];
    const existing = comments.find((comment) => comment.id === commentId);

    if (url.pathname === "/v1/users/me") {
      return json({
        object: "user",
        id: BOT_ID,
        type: "bot",
        name: "Acme Bot",
      });
    }
    if (method === "GET" && url.pathname === "/v1/comments") {
      const blockId = url.searchParams.get("block_id");
      const results = comments.filter(
        (comment) =>
          comment.parent.type === "page_id" &&
          comment.parent.page_id === blockId,
      );
      return json({ results, has_more: false, next_cursor: null });
    }
    if (method === "POST" && url.pathname === "/v1/comments") {
      const richText = body.rich_text ?? [];
      const created = addComment(body.discussion_id ?? "", richText, BOT_ID);
      writes.push(`create ${created.id} ${richTextToPlainText(richText)}`);
      return json(created);
    }
    if (!existing) return notFound();
    switch (method) {
      case "GET":
        if (commentReadsDown > 0) {
          commentReadsDown -= 1;
          return json(
            { object: "error", code: "service_unavailable", message: "busy" },
            503,
          );
        }
        return json(existing);
      case "PATCH":
        existing.rich_text = body.rich_text ?? [];
        writes.push(
          `update ${existing.id} ${richTextToPlainText(existing.rich_text)}`,
        );
        return json(existing);
      case "DELETE":
        comments.splice(comments.indexOf(existing), 1);
        writes.push(`delete ${existing.id}`);
        return json(existing);
      default:
        return notFound();
    }
  };

  return {
    fetch: fetchImpl,
    writes,
    requests,
    /** A comment written by a person (it does not go through the API). */
    userComment: (discussionId: string, richText: RichTextItem[]) =>
      addComment(discussionId, richText, USER_ID),
    /** Answer the next comment read (`GET /v1/comments/{id}`) with a 503. */
    failNextCommentRead: () => {
      commentReadsDown += 1;
    },
    /** A comment written by the bot outside the adapter, e.g. by another process. */
    botComment: (discussionId: string, richText: RichTextItem[]) =>
      addComment(discussionId, richText, BOT_ID),
  };
}

type FakeNotion = ReturnType<typeof createFakeNotion>;

function sign(rawBody: string, key = VERIFICATION_TOKEN) {
  return "sha256=" + createHmac("sha256", key).update(rawBody).digest("hex");
}

function webhookRequest(rawBody: string, signature?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature !== undefined) headers.set("x-notion-signature", signature);
  return new Request("http://localhost/webhook", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

let eventSeq = 0;

/** The `comment.created` event Notion sends for `comment` (ids only). */
function commentCreatedEvent(comment: NotionComment) {
  eventSeq += 1;
  const authorId = comment.created_by.id;
  const event: NotionWebhookEvent = {
    id: `evt-${eventSeq}`,
    timestamp: comment.created_time,
    workspace_id: "ws-1",
    subscription_id: "sub-1",
    integration_id: "int-1",
    type: "comment.created",
    authors: [{ id: authorId, type: authorId === BOT_ID ? "bot" : "person" }],
    entity: { id: comment.id, type: "comment" },
    data: { page_id: PAGE_ID, parent: { id: PAGE_ID, type: "page" } },
  };
  return event;
}

/** POST one signed event to the adapter and return the response status. */
async function post(adapter: NotionAdapter, event: NotionWebhookEvent) {
  const rawBody = JSON.stringify(event);
  const response = await adapter.handleWebhook(
    webhookRequest(rawBody, sign(rawBody)),
  );
  return response.status;
}

/** POST the signed `comment.created` event for `comment` to the adapter. */
async function deliver(adapter: NotionAdapter, comment: NotionComment) {
  expect(await post(adapter, commentCreatedEvent(comment))).toBe(200);
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

/** An agent run that streams `chunks` as one text message, a tick apart. */
function streamText(chunks: string[]) {
  return async (subscriber: AgentSubscriber) => {
    const base = {
      messages: [],
      state: {},
      agent: new FakeAgent(),
      input: RUN_INPUT,
    };
    const messageId = "m1";
    await subscriber.onTextMessageStartEvent?.({
      ...base,
      event: {
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
      },
    });
    for (const delta of chunks) {
      await subscriber.onTextMessageContentEvent?.({
        ...base,
        event: { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta },
        textMessageBuffer: "",
      });
      await tick();
    }
    await subscriber.onTextMessageEndEvent?.({
      ...base,
      event: { type: EventType.TEXT_MESSAGE_END, messageId },
      textMessageBuffer: "",
    });
  };
}

const activeChannels: Channel[] = [];

/**
 * A channel with one Notion adapter over a fake Notion API. Every agent run
 * streams "Here is" + " the summary.". `agentRuns` counts the runs.
 */
async function startNotion(handler: ChannelHandler) {
  const api = createFakeNotion();
  const adapter = notion({
    token: "secret_token",
    verificationToken: VERIFICATION_TOKEN,
    apiBaseUrl: API_BASE_URL,
    fetch: api.fetch,
  });
  const counters = { agentRuns: 0 };
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
    agent: () => {
      counters.agentRuns += 1;
      return new FakeAgent([streamText(["Here is", " the summary."])]);
    },
  });
  channel.onMessage(handler);
  await channel.ɵruntime.start();
  activeChannels.push(channel);
  return { adapter, api, counters };
}

const runAgent: ChannelHandler = async ({ thread }) => {
  await thread.runAgent();
};

/** Wait until the adapter fetched `comment`, then let its event settle. */
async function settled(api: FakeNotion, comment: NotionComment) {
  await vi.waitFor(() =>
    expect(api.requests).toContain(`GET /v1/comments/${comment.id}`),
  );
  await tick();
}

describe("notion() adapter, end to end", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    while (activeChannels.length > 0) {
      await activeChannels.pop()?.ɵruntime.stop();
    }
  });

  it("streams the agent reply into a new comment in the same discussion", async () => {
    const { adapter, api } = await startNotion(runAgent);
    const question = api.userComment("disc-1", [
      botMention(),
      text(" summarize this page"),
    ]);

    await deliver(adapter, question);

    await vi.waitFor(() =>
      expect(api.writes).toEqual([
        "create c2 Here is",
        "update c2 Here is the summary.",
      ]),
    );
  });

  it("answers a follow-up without a mention once the bot replied, with trigger-free history", async () => {
    const seen: { turnText: string; history: string[] }[] = [];
    const { adapter, api } = await startNotion(async ({ thread, message }) => {
      const history = await thread.getMessages();
      seen.push({
        turnText: message.text,
        history: history.map((entry) => entry.text),
      });
      await thread.runAgent();
    });
    const question = api.userComment("disc-1", [
      text("@Acme Bot summarize this page"),
    ]);
    await deliver(adapter, question);
    await vi.waitFor(() => expect(api.writes).toHaveLength(2));

    const followUp = api.userComment("disc-1", [text("and make it shorter")]);
    await deliver(adapter, followUp);

    await vi.waitFor(() =>
      expect(api.writes.slice(2)).toEqual([
        "create c4 Here is",
        "update c4 Here is the summary.",
      ]),
    );
    expect(seen).toEqual([
      { turnText: "summarize this page", history: ["summarize this page"] },
      {
        turnText: "and make it shorter",
        history: [
          "summarize this page",
          "Here is the summary.",
          "and make it shorter",
        ],
      },
    ]);
  });

  it("ignores a comment without a mention in a discussion the bot never joined", async () => {
    const { adapter, api, counters } = await startNotion(runAgent);
    const unrelated = api.userComment("disc-2", [text("summarize this page")]);

    await deliver(adapter, unrelated);
    await settled(api, unrelated);

    expect(counters.agentRuns).toBe(0);
    expect(api.writes).toEqual([]);
  });

  it("ignores the bot's own comments", async () => {
    const { adapter, api, counters } = await startNotion(runAgent);
    const own = api.botComment("disc-1", [text("@Acme Bot summarize this")]);

    await deliver(adapter, own);
    await vi.waitFor(() => expect(api.requests).toContain("GET /v1/users/me"));
    await tick();

    expect(counters.agentRuns).toBe(0);
    expect(api.writes).toEqual([]);
  });

  it("reads the comment before it answers 200, and runs the agent after", async () => {
    const { adapter, api, counters } = await startNotion(runAgent);
    const question = api.userComment("disc-1", [botMention(), text(" hi")]);

    await deliver(adapter, question);

    expect(api.requests).toContain(`GET /v1/comments/${question.id}`);
    expect(counters.agentRuns).toBe(0);
    await vi.waitFor(() => expect(counters.agentRuns).toBe(1));
  });

  it("answers 500 when the comment read fails, and handles Notion's retry", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { adapter, api, counters } = await startNotion(runAgent);
    const question = api.userComment("disc-1", [botMention(), text(" hi")]);
    const event = commentCreatedEvent(question);
    api.failNextCommentRead();

    expect(await post(adapter, event)).toBe(500);
    await tick();
    expect(counters.agentRuns).toBe(0);
    expect(api.writes).toEqual([]);
    expect(error).toHaveBeenCalledTimes(1);

    expect(await post(adapter, { ...event, attempt_number: 2 })).toBe(200);
    await vi.waitFor(() =>
      expect(api.writes).toEqual([
        "create c2 Here is",
        "update c2 Here is the summary.",
      ]),
    );
  });

  it("resolves thread.awaitChoice with the value of a numbered reply", async () => {
    const state: { chosen?: unknown } = {};
    const { adapter, api } = await startNotion(async ({ thread }) => {
      state.chosen = await thread.awaitChoice(
        Actions({
          children: [
            Button({ value: "draft", children: "Save as draft" }),
            Button({ value: "publish", children: "Publish now" }),
          ],
        }),
      );
    });
    const question = api.userComment("disc-1", [
      botMention(),
      text(" ship it"),
    ]);
    await deliver(adapter, question);
    await vi.waitFor(() =>
      expect(api.writes).toEqual([
        "create c2 Reply with a number:\n1. Save as draft\n2. Publish now",
      ]),
    );

    const answer = api.userComment("disc-1", [text("2")]);
    await deliver(adapter, answer);

    await vi.waitFor(() => expect(state.chosen).toBe("publish"));
  });
});

describe("notion() adapter webhook", () => {
  it("rejects an event with a bad signature with 401 and calls no Notion API", async () => {
    const api = createFakeNotion();
    const adapter = notion({
      token: "secret_token",
      verificationToken: VERIFICATION_TOKEN,
      apiBaseUrl: API_BASE_URL,
      fetch: api.fetch,
    });
    const comment = api.userComment("disc-1", [botMention(), text(" hi")]);
    const rawBody = JSON.stringify(commentCreatedEvent(comment));

    const response = await adapter.handleWebhook(
      webhookRequest(rawBody, sign(rawBody, "wrong-token")),
    );
    await tick();

    expect(response.status).toBe(401);
    expect(api.requests).toEqual([]);
  });

  it("hands the verification token to onVerificationToken before a token is configured", async () => {
    const received: string[] = [];
    const adapter = notion({
      token: "secret_token",
      onVerificationToken: (token) => {
        received.push(token);
      },
    });
    const rawBody = JSON.stringify({
      verification_token: "secret_from_notion",
    });

    const response = await adapter.handleWebhook(webhookRequest(rawBody));

    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(received).toEqual(["secret_from_notion"]));
  });
});

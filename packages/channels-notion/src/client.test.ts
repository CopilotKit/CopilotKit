import { afterEach, describe, expect, it, vi } from "vitest";
import { NotionApiClient, NotionApiError } from "./client.js";
import type { NotionComment, RichTextItem } from "./types.js";

interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Fake Notion: returns the queued responses in order and records each request. */
function createNotion(responses: Response[]) {
  const requests: RecordedRequest[] = [];
  const queue = [...responses];
  async function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    requests.push({
      method: init?.method ?? "GET",
      url: String(input),
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const next = queue.shift();
    if (next === undefined) throw new Error("fake Notion: no response queued");
    return next;
  }
  const client = new NotionApiClient({
    token: "secret_TOKEN",
    apiBaseUrl: "https://notion.test",
    fetch: fakeFetch,
  });
  return { client, requests };
}

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function notionError(
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>,
) {
  return json({ object: "error", status, code, message }, { status, headers });
}

function createComment(
  id: string,
  discussionId: string,
  text = `text of ${id}`,
): NotionComment {
  return {
    object: "comment",
    id,
    discussion_id: discussionId,
    parent: { type: "page_id", page_id: "page-1" },
    created_by: { object: "user", id: "user-1" },
    created_time: "2026-11-10T10:00:00.000Z",
    rich_text: [{ type: "text", text: { content: text }, plain_text: text }],
  };
}

/** `count` list pages of one comment each in discussion "d-1", chained by cursor. */
function commentPages(count: number, options: { lastHasMore: boolean }) {
  return Array.from({ length: count }, (_, i) => {
    const hasMore = i < count - 1 || options.lastHasMore;
    return json({
      object: "list",
      results: [createComment(`c-${i}`, "d-1")],
      has_more: hasMore,
      next_cursor: hasMore ? `cursor-${i + 1}` : null,
    });
  });
}

const EXPECTED_HEADERS = {
  authorization: "Bearer secret_TOKEN",
  "notion-version": "2026-03-11",
  "content-type": "application/json",
};

const HELLO: RichTextItem[] = [{ type: "text", text: { content: "hello" } }];

afterEach(() => {
  vi.useRealTimers();
});

describe("NotionApiClient requests", () => {
  it("retrieveComment GETs the comment by id with auth and the pinned version", async () => {
    const comment = createComment("c-1", "d-1");
    const { client, requests } = createNotion([json(comment)]);

    const result = await client.retrieveComment("c-1");

    expect(result).toEqual(comment);
    expect(requests).toEqual([
      {
        method: "GET",
        url: "https://notion.test/v1/comments/c-1",
        headers: EXPECTED_HEADERS,
        body: undefined,
      },
    ]);
  });

  it("createComment POSTs discussion_id and rich_text", async () => {
    const posted = createComment("c-2", "d-1", "hello");
    const { client, requests } = createNotion([json(posted)]);

    const result = await client.createComment({
      discussionId: "d-1",
      richText: HELLO,
    });

    expect(result).toEqual(posted);
    expect(requests).toEqual([
      {
        method: "POST",
        url: "https://notion.test/v1/comments",
        headers: EXPECTED_HEADERS,
        body: {
          discussion_id: "d-1",
          rich_text: [{ type: "text", text: { content: "hello" } }],
        },
      },
    ]);
  });

  it("updateComment PATCHes rich_text on the comment", async () => {
    const updated = createComment("c-2", "d-1", "hello");
    const { client, requests } = createNotion([json(updated)]);

    const result = await client.updateComment("c-2", HELLO);

    expect(result).toEqual(updated);
    expect(requests).toEqual([
      {
        method: "PATCH",
        url: "https://notion.test/v1/comments/c-2",
        headers: EXPECTED_HEADERS,
        body: { rich_text: [{ type: "text", text: { content: "hello" } }] },
      },
    ]);
  });

  it("deleteComment sends DELETE for the comment", async () => {
    const { client, requests } = createNotion([
      json(createComment("c-2", "d-1")),
    ]);

    await expect(client.deleteComment("c-2")).resolves.toBeUndefined();
    expect(requests).toEqual([
      {
        method: "DELETE",
        url: "https://notion.test/v1/comments/c-2",
        headers: EXPECTED_HEADERS,
        body: undefined,
      },
    ]);
  });

  it("getBotUser returns the bot id and name from /v1/users/me", async () => {
    const { client, requests } = createNotion([
      json({
        object: "user",
        id: "bot-1",
        type: "bot",
        name: "Helper",
        avatar_url: null,
        bot: {},
      }),
    ]);

    expect(await client.getBotUser()).toEqual({ id: "bot-1", name: "Helper" });
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET https://notion.test/v1/users/me",
    ]);
  });

  it("getBotUser returns a null name when Notion has none", async () => {
    const { client } = createNotion([
      json({ object: "user", id: "bot-1", type: "bot", name: null }),
    ]);

    expect(await client.getBotUser()).toEqual({ id: "bot-1", name: null });
  });
});

describe("NotionApiClient.listDiscussionComments", () => {
  it("pages through the block's comments and keeps only the discussion", async () => {
    const { client, requests } = createNotion([
      json({
        object: "list",
        results: [createComment("c-1", "d-1"), createComment("c-2", "d-2")],
        has_more: true,
        next_cursor: "cursor-2",
      }),
      json({
        object: "list",
        results: [createComment("c-3", "d-1")],
        has_more: false,
        next_cursor: null,
      }),
    ]);

    const comments = await client.listDiscussionComments("page-1", "d-1");

    expect(comments.map((c) => c.id)).toEqual(["c-1", "c-3"]);
    expect(requests.map((r) => r.url)).toEqual([
      "https://notion.test/v1/comments?block_id=page-1&page_size=100",
      "https://notion.test/v1/comments?block_id=page-1&page_size=100&start_cursor=cursor-2",
    ]);
  });

  it("reads every page, so the newest comment is in the list", async () => {
    const { client } = createNotion(commentPages(12, { lastHasMore: false }));

    const comments = await client.listDiscussionComments("page-1", "d-1");

    expect(comments).toHaveLength(12);
    expect(comments.at(-1)?.id).toBe("c-11");
  });

  it("throws after 100 pages instead of returning a list without the newest comments", async () => {
    const { client, requests } = createNotion(
      commentPages(100, { lastHasMore: true }),
    );

    await expect(
      client.listDiscussionComments("page-1", "d-1"),
    ).rejects.toThrow("Notion block page-1 has more than 10000 comments");
    expect(requests).toHaveLength(100);
  });
});

describe("NotionApiClient errors", () => {
  it("maps a Notion error body to NotionApiError", async () => {
    const { client } = createNotion([
      notionError(404, "object_not_found", "Could not find comment c-9."),
    ]);

    const error = await client.retrieveComment("c-9").catch((e) => e);

    expect(error).toBeInstanceOf(NotionApiError);
    expect(error).toMatchObject({
      status: 404,
      code: "object_not_found",
      message: "Could not find comment c-9.",
      retryAfterMs: undefined,
    });
  });

  it("uses code 'unknown' and the raw text when the body is not JSON", async () => {
    const { client } = createNotion([
      new Response("upstream down", { status: 502 }),
    ]);

    const error = await client.retrieveComment("c-1").catch((e) => e);

    expect(error).toBeInstanceOf(NotionApiError);
    expect(error).toMatchObject({
      status: 502,
      code: "unknown",
      message: "Notion API 502: upstream down",
    });
  });

  it("throws a 429 with retryAfterMs when Retry-After is above the inline cap", async () => {
    const { client, requests } = createNotion([
      notionError(429, "rate_limited", "Rate limited.", {
        "Retry-After": "30",
      }),
    ]);

    const error = await client.retrieveComment("c-1").catch((e) => e);

    expect(error).toBeInstanceOf(NotionApiError);
    expect(error).toMatchObject({
      status: 429,
      code: "rate_limited",
      retryAfterMs: 30_000,
    });
    expect(requests).toHaveLength(1);
  });

  it("retries a short 429 once after Retry-After and returns the result", async () => {
    vi.useFakeTimers();
    const comment = createComment("c-1", "d-1");
    const { client, requests } = createNotion([
      notionError(429, "rate_limited", "Rate limited.", { "Retry-After": "2" }),
      json(comment),
    ]);

    const pending = client.retrieveComment("c-1");
    await vi.advanceTimersByTimeAsync(1_999);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).toEqual(comment);
    expect(requests).toHaveLength(2);
  });

  it("throws when the retried request is rate limited again", async () => {
    vi.useFakeTimers();
    const { client, requests } = createNotion([
      notionError(429, "rate_limited", "Rate limited.", { "Retry-After": "1" }),
      notionError(429, "rate_limited", "Still limited.", {
        "Retry-After": "1",
      }),
    ]);

    const pending = client.retrieveComment("c-1").catch((e) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    const error = await pending;

    expect(error).toBeInstanceOf(NotionApiError);
    expect(error).toMatchObject({
      status: 429,
      message: "Still limited.",
      retryAfterMs: 1_000,
    });
    expect(requests).toHaveLength(2);
  });
});

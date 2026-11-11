import type {
  NotionAdapterOptions,
  NotionComment,
  NotionUser,
  RichTextItem,
} from "./types.js";

/** Client options: the Notion-facing subset of {@link NotionAdapterOptions}. */
export type NotionApiClientOptions = Pick<
  NotionAdapterOptions,
  "token" | "apiBaseUrl" | "notionVersion" | "fetch"
>;

const DEFAULT_API_BASE_URL = "https://api.notion.com";
const DEFAULT_NOTION_VERSION = "2026-03-11";

/** `page_size` for `GET /v1/comments` (the API maximum). */
const LIST_PAGE_SIZE = 100;
/**
 * Page cap for one discussion listing: 100 pages x 100 = 10000 comments.
 * Notion lists comments oldest first, so a listing cut at this cap would miss
 * the newest comments, the inbound turn among them. The client throws instead.
 */
const LIST_MAX_PAGES = 100;

/**
 * A 429 is retried once, in place, only when `Retry-After` is at most this
 * many milliseconds. A longer wait (the per-workspace limit can exceed 60 s)
 * would stall a webhook turn, so the error goes to the caller with
 * `retryAfterMs` set instead.
 */
const MAX_INLINE_RETRY_AFTER_MS = 5_000;

/**
 * A non-2xx response from the Notion API.
 *
 * `code` is Notion's error code (for example `object_not_found`,
 * `rate_limited`, `validation_error`), or `"unknown"` when the body is not a
 * Notion error object. `retryAfterMs` is set from the `Retry-After` header
 * (seconds) on a 429.
 */
export class NotionApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterMs?: number;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    retryAfterMs?: number;
  }) {
    super(init.message);
    this.name = "NotionApiError";
    this.status = init.status;
    this.code = init.code;
    this.retryAfterMs = init.retryAfterMs;
  }
}

interface NotionCommentList {
  results: NotionComment[];
  has_more: boolean;
  next_cursor: string | null;
}

interface NotionErrorBody {
  code?: string;
  message?: string;
}

/**
 * Small typed client for the Notion comments API over `fetch`.
 *
 * Every request sends `Authorization: Bearer <token>` and the pinned
 * `Notion-Version` header. Methods throw {@link NotionApiError} on a non-2xx
 * response. A 429 whose `Retry-After` is 5 seconds or less is retried once
 * after that wait; any other 429 throws with `retryAfterMs` set.
 *
 * @example
 * const client = new NotionApiClient({ token: process.env.NOTION_TOKEN! });
 * const comment = await client.retrieveComment(event.entity.id);
 * await client.createComment({ discussionId: comment.discussion_id, richText });
 */
export class NotionApiClient {
  private readonly token: string;
  private readonly apiBaseUrl: string;
  private readonly notionVersion: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NotionApiClientOptions) {
    this.token = options.token;
    this.apiBaseUrl = options.apiBaseUrl ?? DEFAULT_API_BASE_URL;
    this.notionVersion = options.notionVersion ?? DEFAULT_NOTION_VERSION;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  /** Get one comment by id (`GET /v1/comments/{id}`). Needs "Read comments". */
  async retrieveComment(commentId: string) {
    return this.request<NotionComment>(
      "GET",
      `/v1/comments/${encodeURIComponent(commentId)}`,
    );
  }

  /**
   * List the un-resolved comments of one discussion, oldest first.
   *
   * Notion lists comments per page or block (`GET /v1/comments?block_id=`),
   * so this pages through the whole list and keeps the ones whose
   * `discussion_id` matches. It throws when the block has more than 10000
   * comments: Notion lists oldest first, so a cut list would miss the newest.
   *
   * @param blockOrPageId Page or block that holds the discussion.
   * @param discussionId Discussion thread to keep.
   */
  async listDiscussionComments(blockOrPageId: string, discussionId: string) {
    const comments: NotionComment[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < LIST_MAX_PAGES; page++) {
      const query = new URLSearchParams({
        block_id: blockOrPageId,
        page_size: String(LIST_PAGE_SIZE),
      });
      if (cursor !== null) query.set("start_cursor", cursor);
      const list = await this.request<NotionCommentList>(
        "GET",
        `/v1/comments?${query.toString()}`,
      );
      const inDiscussion = list.results.filter(
        (comment) => comment.discussion_id === discussionId,
      );
      comments.push(...inDiscussion);
      if (!list.has_more || list.next_cursor === null) return comments;
      cursor = list.next_cursor;
    }
    throw new Error(
      `Notion block ${blockOrPageId} has more than ${LIST_MAX_PAGES * LIST_PAGE_SIZE} comments; the discussion history cannot be read.`,
    );
  }

  /**
   * Reply in an existing discussion (`POST /v1/comments`). Needs "Insert comments".
   *
   * @param reply.discussionId Discussion thread to post into.
   * @param reply.richText Comment body (max 100 items, 2000 chars per text item).
   */
  async createComment(reply: {
    discussionId: string;
    richText: RichTextItem[];
  }) {
    return this.request<NotionComment>("POST", "/v1/comments", {
      discussion_id: reply.discussionId,
      rich_text: reply.richText,
    });
  }

  /** Replace the body of a comment this integration created (`PATCH /v1/comments/{id}`). */
  async updateComment(commentId: string, richText: RichTextItem[]) {
    return this.request<NotionComment>(
      "PATCH",
      `/v1/comments/${encodeURIComponent(commentId)}`,
      { rich_text: richText },
    );
  }

  /** Delete a comment this integration created (`DELETE /v1/comments/{id}`). */
  async deleteComment(commentId: string) {
    await this.request<NotionComment>(
      "DELETE",
      `/v1/comments/${encodeURIComponent(commentId)}`,
    );
  }

  /** The integration's own bot user (`GET /v1/users/me`): its id and display name. */
  async getBotUser() {
    const user = await this.request<NotionUser>("GET", "/v1/users/me");
    return { id: user.id, name: user.name ?? null };
  }

  private async request<T>(method: string, path: string, body?: object) {
    const send = () =>
      this.fetchImpl(`${this.apiBaseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Notion-Version": this.notionVersion,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    let res = await send();
    const retryAfterMs = parseRetryAfterMs(res);
    const canRetryInline =
      res.status === 429 &&
      retryAfterMs !== undefined &&
      retryAfterMs <= MAX_INLINE_RETRY_AFTER_MS;
    if (canRetryInline) {
      await res.body?.cancel();
      await delay(retryAfterMs);
      res = await send();
    }
    if (!res.ok) throw await toNotionApiError(res);
    return (await res.json()) as T;
  }
}

function parseRetryAfterMs(res: Response) {
  const header = res.headers.get("Retry-After");
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

async function toNotionApiError(res: Response) {
  const text = await res.text().catch(() => "");
  const parsed = parseErrorBody(text);
  return new NotionApiError({
    status: res.status,
    code: parsed?.code ?? "unknown",
    message:
      parsed?.message ?? `Notion API ${res.status}: ${text || res.statusText}`,
    retryAfterMs: res.status === 429 ? parseRetryAfterMs(res) : undefined,
  });
}

function parseErrorBody(text: string) {
  try {
    return JSON.parse(text) as NotionErrorBody;
  } catch {
    return undefined;
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

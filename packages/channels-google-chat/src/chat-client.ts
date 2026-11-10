import type { TokenProvider } from "./auth.js";

const DEFAULT_API_URL = "https://chat.googleapis.com/v1";

export class ChatClient {
  private readonly tokenProvider: TokenProvider;
  private readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(args: {
    tokenProvider: TokenProvider;
    apiUrl?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.tokenProvider = args.tokenProvider;
    this.apiUrl = (args.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "");
    this.fetchImpl = args.fetchImpl ?? fetch;
  }

  private async request(
    path: string,
    init: RequestInit & { query?: Record<string, string> },
  ): Promise<Response> {
    const token = await this.tokenProvider.getToken();
    const url = new URL(`${this.apiUrl}${path}`);
    // `query` is a custom field on our `init` shape, not part of `RequestInit`.
    // Strip it out before spreading into the fetch options so we never pass an
    // unknown `query` key into `fetch`.
    const { query, ...fetchInit } = init;
    for (const [k, v] of Object.entries(query ?? {}))
      url.searchParams.set(k, v);
    const res = await this.fetchImpl(url, {
      ...fetchInit,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...fetchInit.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `google-chat ${fetchInit.method ?? "GET"} ${path} failed: ${res.status} ${body}`,
      );
    }
    return res;
  }

  async createMessage(
    space: string,
    body: object,
    opts?: { threadName?: string; replyToThread?: boolean },
  ): Promise<{ name: string; thread?: string }> {
    const payload: Record<string, unknown> = { ...body };
    if (opts?.threadName) payload.thread = { name: opts.threadName };
    const query: Record<string, string> = {};
    if (opts?.replyToThread)
      query.messageReplyOption = "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD";
    const res = await this.request(`/${space}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
      query,
    });
    const json = (await res.json()) as {
      name?: string;
      thread?: { name?: string };
    };
    if (!json.name) {
      throw new Error(
        "google-chat createMessage: response missing message name",
      );
    }
    return {
      name: json.name,
      ...(json.thread?.name ? { thread: json.thread.name } : {}),
    };
  }

  async patchMessage(
    name: string,
    body: object,
    updateMask: string,
  ): Promise<void> {
    // Fail loud on an empty/falsy name: `adapter.stream()` can return
    // `{ id: "" }` for an empty agent response (no placeholder posted), and a
    // PATCH against `/` would silently hit a malformed URL.
    if (!name) {
      throw new Error("google-chat patchMessage: empty message name");
    }
    await this.request(`/${name}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      query: { updateMask },
    });
  }

  async deleteMessage(name: string): Promise<void> {
    // Fail loud on an empty/falsy name (see `patchMessage`): a DELETE against
    // `/` would silently hit a malformed URL.
    if (!name) {
      throw new Error("google-chat deleteMessage: empty message name");
    }
    await this.request(`/${name}`, { method: "DELETE" });
  }
}

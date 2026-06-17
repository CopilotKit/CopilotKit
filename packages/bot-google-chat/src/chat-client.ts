import type { TokenProvider } from "./auth.js";

const DEFAULT_API_URL = "https://chat.googleapis.com/v1";

export interface ChatMessage {
  name?: string;
  text?: string;
  sender?: { name?: string; type?: string };
  createTime?: string;
}

export class ChatClient {
  private readonly tokenProvider: TokenProvider;
  private readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(args: { tokenProvider: TokenProvider; apiUrl?: string; fetchImpl?: typeof fetch }) {
    this.tokenProvider = args.tokenProvider;
    this.apiUrl = (args.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "");
    this.fetchImpl = args.fetchImpl ?? fetch;
  }

  private async request(path: string, init: RequestInit & { query?: Record<string, string> }): Promise<Response> {
    const token = await this.tokenProvider.getToken();
    const url = new URL(`${this.apiUrl}${path}`);
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
    const res = await this.fetchImpl(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`google-chat ${init.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
    }
    return res;
  }

  async createMessage(
    space: string,
    body: object,
    opts?: { threadName?: string; replyToThread?: boolean },
  ): Promise<{ name: string }> {
    const payload: Record<string, unknown> = { ...body };
    if (opts?.threadName) payload.thread = { name: opts.threadName };
    const query: Record<string, string> = {};
    if (opts?.replyToThread) query.messageReplyOption = "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD";
    const res = await this.request(`/${space}/messages`, { method: "POST", body: JSON.stringify(payload), query });
    const json = (await res.json()) as { name?: string };
    return { name: json.name ?? "" };
  }

  async patchMessage(name: string, body: object, updateMask: string): Promise<void> {
    await this.request(`/${name}`, { method: "PATCH", body: JSON.stringify(body), query: { updateMask } });
  }

  async deleteMessage(name: string): Promise<void> {
    await this.request(`/${name}`, { method: "DELETE" });
  }

  async listMessages(space: string, pageSize = 100): Promise<ChatMessage[]> {
    const res = await this.request(`/${space}/messages`, { method: "GET", query: { pageSize: String(pageSize) } });
    const json = (await res.json()) as { messages?: ChatMessage[] };
    return json.messages ?? [];
  }

  async uploadAttachment(space: string, bytes: Uint8Array, filename: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const token = await this.tokenProvider.getToken();
      const url = new URL(`${this.apiUrl}/${space}/messages`);
      url.searchParams.set("messageId", "");
      // Chat media upload is multipart; v1 keeps this best-effort.
      const form = new FormData();
      form.append("file", new Blob([bytes]), filename);
      const res = await this.fetchImpl(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      if (!res.ok) return { ok: false, error: `${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

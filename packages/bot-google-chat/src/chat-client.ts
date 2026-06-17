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
  private readonly uploadUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(args: { tokenProvider: TokenProvider; apiUrl?: string; fetchImpl?: typeof fetch }) {
    this.tokenProvider = args.tokenProvider;
    this.apiUrl = (args.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "");
    // Google Chat media upload uses a distinct `/upload/v1` base (e.g.
    // https://chat.googleapis.com/upload/v1) rather than the `/v1` REST base.
    // Derive it from apiUrl by swapping a trailing `/v1` for `/upload/v1`,
    // staying robust to the default `https://chat.googleapis.com/v1`.
    this.uploadUrl = this.apiUrl.endsWith("/v1")
      ? `${this.apiUrl.slice(0, -"/v1".length)}/upload/v1`
      : `${this.apiUrl}/upload/v1`;
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
    if (!json.name) {
      throw new Error("google-chat createMessage: response missing message name");
    }
    return { name: json.name };
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

  async uploadAttachment(
    space: string,
    bytes: Uint8Array,
    filename: string,
  ): Promise<{ ok: boolean; fileId?: string; error?: string }> {
    try {
      const token = await this.tokenProvider.getToken();

      // Step 1: upload the media bytes to the dedicated upload endpoint.
      // POST {uploadUrl}/{space}/attachments:upload?uploadType=multipart with a
      // multipart body containing a JSON metadata part and the file bytes.
      const uploadEndpoint = new URL(`${this.uploadUrl}/${space}/attachments:upload`);
      uploadEndpoint.searchParams.set("uploadType", "multipart");
      const form = new FormData();
      // Metadata part: the desired display filename for the attachment.
      form.append("metadata", new Blob([JSON.stringify({ filename })], { type: "application/json" }));
      // Copy into a fresh ArrayBuffer-backed view so the Blob part is typed as
      // a concrete BlobPart under lib.dom (avoids SharedArrayBuffer typing).
      form.append("file", new Blob([new Uint8Array(bytes)]), filename);
      const uploadRes = await this.fetchImpl(uploadEndpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!uploadRes.ok) {
        const body = await uploadRes.text().catch(() => "");
        return { ok: false, error: `upload failed: ${uploadRes.status} ${body}` };
      }
      const uploadJson = (await uploadRes.json()) as {
        attachmentDataRef?: { resourceName?: string; attachmentUploadToken?: string };
      };
      const attachmentDataRef = uploadJson.attachmentDataRef;
      if (!attachmentDataRef || (!attachmentDataRef.resourceName && !attachmentDataRef.attachmentUploadToken)) {
        return { ok: false, error: "upload response missing attachmentDataRef" };
      }

      // Step 2: create a message referencing the uploaded attachment via the
      // normal REST base.
      const createRes = await this.request(`/${space}/messages`, {
        method: "POST",
        body: JSON.stringify({ attachment: [{ attachmentDataRef }] }),
      });
      // Drain the body so the response is fully consumed (and surface failures).
      await createRes.json().catch(() => undefined);

      const fileId = attachmentDataRef.resourceName ?? attachmentDataRef.attachmentUploadToken;
      return { ok: true, fileId };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

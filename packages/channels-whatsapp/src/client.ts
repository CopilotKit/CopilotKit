import type { WhatsAppMessageRef } from "./types.js";
import type { WhatsAppOutbound } from "./render/message.js";

export interface WhatsAppClientOptions {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
  graphBaseUrl?: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface DownloadedMedia {
  bytes: Uint8Array;
  mimeType: string;
}

/** Thin Cloud API client over fetch — send messages, upload/download media. */
export class WhatsAppClient {
  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly apiVersion: string;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: WhatsAppClientOptions) {
    this.accessToken = opts.accessToken;
    this.phoneNumberId = opts.phoneNumberId;
    this.apiVersion = opts.apiVersion ?? "v21.0";
    this.base = opts.graphBaseUrl ?? "https://graph.facebook.com";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private get authHeader(): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  /** POST a message; returns the outbound message ref. */
  async sendMessage(
    to: string,
    payload: WhatsAppOutbound,
  ): Promise<WhatsAppMessageRef> {
    const url = `${this.base}/${this.apiVersion}/${this.phoneNumberId}/messages`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { ...this.authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        ...payload,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `WhatsApp sendMessage failed: ${res.status} ${await safeText(res)}`,
      );
    }
    const json = (await res.json()) as { messages?: Array<{ id?: string }> };
    const id = json.messages?.[0]?.id ?? "";
    return { id, to, phoneNumberId: this.phoneNumberId };
  }

  /**
   * Mark an inbound message as read and optionally show a typing indicator.
   * The indicator displays for up to ~25s or until the next message is sent —
   * it's the only "pending" affordance WhatsApp offers (no streaming/edits).
   * Throws on a non-2xx so callers can decide; ingress fires it best-effort.
   */
  async sendReadReceipt(
    messageId: string,
    opts: { typing?: boolean } = {},
  ): Promise<void> {
    const url = `${this.base}/${this.apiVersion}/${this.phoneNumberId}/messages`;
    const body: Record<string, unknown> = {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    };
    if (opts.typing) body.typing_indicator = { type: "text" };
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { ...this.authHeader, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `WhatsApp read/typing failed: ${res.status} ${await safeText(res)}`,
      );
    }
  }

  /** Upload media (multipart) and return its media id. */
  async uploadMedia(
    bytes: Uint8Array,
    mimeType: string,
    filename = "upload.bin",
  ): Promise<string> {
    const url = `${this.base}/${this.apiVersion}/${this.phoneNumberId}/media`;
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    form.append(
      "file",
      new Blob(
        [
          (bytes.buffer as ArrayBuffer).slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
        ],
        { type: mimeType },
      ),
      filename,
    );
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: this.authHeader,
      body: form,
    });
    if (!res.ok)
      throw new Error(
        `WhatsApp uploadMedia failed: ${res.status} ${await safeText(res)}`,
      );
    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new Error("WhatsApp uploadMedia returned no id");
    return json.id;
  }

  /** Resolve a media id to a download URL, then fetch the bytes. */
  async downloadMedia(mediaId: string): Promise<DownloadedMedia> {
    const metaUrl = `${this.base}/${this.apiVersion}/${mediaId}`;
    const metaRes = await this.fetchImpl(metaUrl, { headers: this.authHeader });
    if (!metaRes.ok)
      throw new Error(`WhatsApp media meta failed: ${metaRes.status}`);
    const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!meta.url) throw new Error("WhatsApp media meta returned no url");
    const blobRes = await this.fetchImpl(meta.url, {
      headers: this.authHeader,
    });
    if (!blobRes.ok)
      throw new Error(`WhatsApp media download failed: ${blobRes.status}`);
    const bytes = new Uint8Array(await blobRes.arrayBuffer());
    return { bytes, mimeType: meta.mime_type ?? "application/octet-stream" };
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

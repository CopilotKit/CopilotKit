import { randomUUID } from "node:crypto";

/** Default Resend API origin. */
export const RESEND_API_URL = "https://api.resend.com";

/** Resend rejects API requests without a `User-Agent` (403, code 1010). */
const USER_AGENT = "copilotkit-channels-resend";

/** The largest wait the client accepts from `retry-after` before giving up, in ms. */
const MAX_RETRY_AFTER_MS = 60_000;

/** A failed Resend API call. */
export class ResendApiError extends Error {
  constructor(
    readonly status: number,
    /** Resend's error `name`, e.g. `rate_limit_exceeded` or `validation_error`. */
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "ResendApiError";
  }
}

/** One attachment on an outbound email. */
export interface ResendOutboundAttachment {
  filename: string;
  /** Base64 file content. */
  content: string;
  content_type?: string;
}

/** Body of `POST /emails`. */
export interface ResendSendPayload {
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string[];
  headers?: Record<string, string>;
  attachments?: ResendOutboundAttachment[];
}

/** Attachment metadata on a received email. */
export interface ResendReceivedAttachment {
  id: string;
  filename?: string | null;
  content_type?: string | null;
  content_disposition?: string | null;
  content_id?: string | null;
  size?: number | null;
  /** Signed URL, valid for about an hour (attachment endpoints only). */
  download_url?: string;
}

/** `GET /emails/receiving/{id}` response (the fields this adapter reads). */
export interface ResendReceivedEmail {
  id: string;
  from: string;
  to?: string[] | null;
  cc?: string[] | null;
  received_for?: string[] | null;
  subject?: string | null;
  html?: string | null;
  text?: string | null;
  message_id?: string | null;
  headers?: Record<string, string | string[] | undefined> | null;
  created_at?: string;
  authentication?: { spf?: string; dkim?: string; dmarc?: string } | null;
  attachments?: ResendReceivedAttachment[] | null;
}

export interface ResendClientOptions {
  apiKey: string;
  /** API origin. Defaults to {@link RESEND_API_URL}. */
  baseUrl?: string;
  /** `fetch` to use. Defaults to the global one. */
  fetch?: typeof fetch;
  /** Retries after a 429 or 5xx response. Default 3. */
  maxRetries?: number;
  /** Wait function. Tests replace it. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Parse `retry-after` (seconds or HTTP date) or `ratelimit-reset` (seconds) into ms. */
export function retryDelayMs(
  headers: Headers,
  now = Date.now(),
): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    if (/^\d+(\.\d+)?$/.test(retryAfter.trim())) {
      return Math.ceil(Number(retryAfter) * 1000);
    }
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  const reset = headers.get("ratelimit-reset");
  if (reset && /^\d+$/.test(reset.trim())) return Number(reset) * 1000;
  return undefined;
}

/** A small `fetch` client for the Resend endpoints the adapter uses. */
export class ResendClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: ResendClientOptions) {
    this.baseUrl = (opts.baseUrl ?? RESEND_API_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? ((...args) => globalThis.fetch(...args));
    this.maxRetries = opts.maxRetries ?? 3;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /**
   * Send one email. Each call uses a fresh `Idempotency-Key`, reused across
   * its own retries, so a retry after a lost response never sends twice.
   */
  async sendEmail(payload: ResendSendPayload): Promise<{ id: string }> {
    return this.request<{ id: string }>("POST", "/emails", payload, {
      "idempotency-key": randomUUID(),
    });
  }

  /** Fetch a received email: body, headers, and attachment metadata. */
  async getReceivedEmail(id: string): Promise<ResendReceivedEmail> {
    return this.request<ResendReceivedEmail>(
      "GET",
      `/emails/receiving/${encodeURIComponent(id)}`,
    );
  }

  /** List a received email's attachments, with fresh download URLs. */
  async listReceivedAttachments(
    emailId: string,
  ): Promise<ResendReceivedAttachment[]> {
    const res = await this.request<{ data?: ResendReceivedAttachment[] }>(
      "GET",
      `/emails/receiving/${encodeURIComponent(emailId)}/attachments?limit=100`,
    );
    return res.data ?? [];
  }

  /**
   * Download a file from a signed URL. Stops reading and throws once the
   * body passes `maxBytes`.
   */
  async download(url: string, maxBytes: number): Promise<Uint8Array> {
    const res = await this.fetchImpl(url, {
      headers: { "user-agent": USER_AGENT },
    });
    if (!res.ok) {
      throw new ResendApiError(
        res.status,
        undefined,
        `download failed (${res.status})`,
      );
    }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel();
      throw new Error(`file is larger than ${maxBytes} bytes`);
    }
    if (!res.body) return new Uint8Array(await res.arrayBuffer());
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error(`file is larger than ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
    const out = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }

  /**
   * One API call. Retries a 429 (rate limit) after `retry-after`, and a 5xx
   * or network error with exponential backoff. Daily and monthly quota
   * errors are not retried: waiting a second does not help.
   */
  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.opts.apiKey}`,
      "user-agent": USER_AGENT,
      ...extraHeaders,
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    for (let attempt = 0; ; attempt++) {
      const backoff = Math.min(500 * 2 ** attempt, 10_000);
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
      } catch (err) {
        if (attempt >= this.maxRetries) throw err;
        await this.sleep(backoff);
        continue;
      }
      if (res.ok) return (await res.json()) as T;

      const error = await readError(res);
      const retryable =
        (res.status === 429 &&
          error.code !== "daily_quota_exceeded" &&
          error.code !== "monthly_quota_exceeded") ||
        res.status >= 500;
      if (!retryable || attempt >= this.maxRetries) throw error;
      const wait =
        res.status === 429 ? (retryDelayMs(res.headers) ?? backoff) : backoff;
      if (wait > MAX_RETRY_AFTER_MS) throw error;
      await this.sleep(wait);
    }
  }
}

async function readError(res: Response): Promise<ResendApiError> {
  let code: string | undefined;
  let message = `Resend API request failed (${res.status})`;
  try {
    const body = (await res.json()) as { name?: unknown; message?: unknown };
    if (typeof body.name === "string") code = body.name;
    if (typeof body.message === "string") message = body.message;
  } catch {
    // Not JSON: keep the generic message.
  }
  return new ResendApiError(res.status, code, message);
}

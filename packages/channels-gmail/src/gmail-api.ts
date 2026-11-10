import type { GmailOAuthCredentials } from "./types.js";

export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
export const GMAIL_UPLOAD_API =
  "https://gmail.googleapis.com/upload/gmail/v1/users/me";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Refresh the access token this long before Google says it expires. */
const EXPIRY_MARGIN_MS = 60_000;

/** A failed Gmail or OAuth request. `status` is the HTTP status. */
export class GmailApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

/**
 * Access tokens from an OAuth2 refresh token. Caches the token until shortly
 * before it expires, and shares one refresh between concurrent callers.
 */
export class RefreshTokenAuth {
  private token: { value: string; expiresAt: number } | undefined;
  private pending: Promise<string> | undefined;

  constructor(
    private readonly creds: GmailOAuthCredentials,
    private readonly fetchImpl: typeof fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now())
      return this.token.value;
    this.pending ??= this.refresh().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  /** Forget the cached token, so the next call refreshes. */
  invalidate(): void {
    this.token = undefined;
  }

  private async refresh(): Promise<string> {
    const res = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.creds.clientId,
        client_secret: this.creds.clientSecret,
        refresh_token: this.creds.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (!res.ok) {
      throw new GmailApiError(
        res.status,
        `Google token refresh failed with status ${res.status}`,
      );
    }
    const body = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (typeof body.access_token !== "string") {
      throw new GmailApiError(res.status, "Google token response has no token");
    }
    const ttlMs = (body.expires_in ?? 3600) * 1000;
    this.token = {
      value: body.access_token,
      expiresAt: this.now() + Math.max(0, ttlMs - EXPIRY_MARGIN_MS),
    };
    return body.access_token;
  }
}

/** Header on a Gmail message part. */
export interface GmailHeader {
  name: string;
  value: string;
}

/** One part of a Gmail message (`format=full`). */
export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  historyId?: string;
  payload?: GmailMessagePart;
}

export interface GmailHistoryPage {
  history?: Array<{
    id: string;
    messagesAdded?: Array<{
      message: { id: string; threadId: string; labelIds?: string[] };
    }>;
  }>;
  nextPageToken?: string;
  historyId: string;
}

export interface GmailClientOptions {
  getAccessToken: () => Promise<string>;
  /** Called after a `401`, before the one retry. */
  onUnauthorized?: () => void;
  fetch: typeof fetch;
}

/** A small Gmail REST client over `fetch`. Only the calls the adapter needs. */
export class GmailClient {
  constructor(private readonly opts: GmailClientOptions) {}

  getProfile(): Promise<{ emailAddress: string; historyId: string }> {
    return this.json(`${GMAIL_API}/profile`);
  }

  watch(args: {
    topicName: string;
    labelIds: string[];
  }): Promise<{ historyId: string; expiration: string }> {
    return this.json(`${GMAIL_API}/watch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        topicName: args.topicName,
        labelIds: args.labelIds,
        labelFilterBehavior: "include",
      }),
    });
  }

  listHistory(args: {
    startHistoryId: string;
    labelId: string;
    pageToken?: string;
  }): Promise<GmailHistoryPage> {
    const params = new URLSearchParams({
      startHistoryId: args.startHistoryId,
      labelId: args.labelId,
      historyTypes: "messageAdded",
      maxResults: "500",
    });
    if (args.pageToken) params.set("pageToken", args.pageToken);
    return this.json(`${GMAIL_API}/history?${params.toString()}`);
  }

  getMessage(id: string): Promise<GmailMessage> {
    return this.json(
      `${GMAIL_API}/messages/${encodeURIComponent(id)}?format=full`,
    );
  }

  async getAttachment(
    messageId: string,
    attachmentId: string,
  ): Promise<Buffer> {
    const body = await this.json<{ data?: string }>(
      `${GMAIL_API}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    return Buffer.from(body.data ?? "", "base64url");
  }

  getThread(id: string): Promise<{ id: string; messages?: GmailMessage[] }> {
    return this.json(
      `${GMAIL_API}/threads/${encodeURIComponent(id)}?format=full`,
    );
  }

  /**
   * Send a raw RFC 5322 message in a thread. Uses the upload endpoint, so a
   * message can be up to 35 MB.
   */
  send(
    raw: Buffer,
    threadId: string,
  ): Promise<{ id: string; threadId: string }> {
    const boundary = `gmail_send_${crypto.randomUUID()}`;
    const head = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify({ threadId })}\r\n` +
        `--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    return this.json(`${GMAIL_UPLOAD_API}/messages/send?uploadType=multipart`, {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body: Buffer.concat([head, raw, tail]),
    });
  }

  private async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    let res = await this.request(url, init);
    if (res.status === 401 && this.opts.onUnauthorized) {
      this.opts.onUnauthorized();
      res = await this.request(url, init);
    }
    if (!res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body.error?.message) detail = `: ${body.error.message}`;
      } catch {
        // No JSON error body.
      }
      throw new GmailApiError(
        res.status,
        `Gmail request failed with status ${res.status}${detail}`,
      );
    }
    return (await res.json()) as T;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const token = await this.opts.getAccessToken();
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    return this.opts.fetch(url, { ...init, headers });
  }
}

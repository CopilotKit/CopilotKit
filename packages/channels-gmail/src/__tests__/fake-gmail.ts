import type { GmailHistoryPage, GmailMessage } from "../gmail-api.js";

/** A MIME entity parsed back from raw bytes, for assertions. */
export interface MimeEntity {
  headers: Map<string, string>;
  /** Decoded body for a leaf part. */
  body: Buffer;
  parts: MimeEntity[];
}

/** Parse raw MIME (as the adapter builds it) into a tree. */
export function parseMime(raw: Buffer | string): MimeEntity {
  const text = typeof raw === "string" ? raw : raw.toString("latin1");
  const split = text.indexOf("\r\n\r\n");
  const head = text.slice(0, split);
  const rest = text.slice(split + 4);
  const headers = new Map<string, string>();
  for (const line of head.replace(/\r\n[ \t]+/g, " ").split("\r\n")) {
    const colon = line.indexOf(":");
    headers.set(
      line.slice(0, colon).toLowerCase(),
      line.slice(colon + 1).trim(),
    );
  }
  const type = headers.get("content-type") ?? "text/plain";
  const boundary = /boundary="?([^";]+)"?/.exec(type)?.[1];
  if (type.startsWith("multipart/") && boundary) {
    const parts = rest
      .split(`--${boundary}`)
      .slice(1)
      .filter((p) => !p.startsWith("--"))
      .map((p) => parseMime(p.replace(/^\r\n/, "").replace(/\r\n$/, "")));
    return { headers, body: Buffer.alloc(0), parts };
  }
  const body =
    headers.get("content-transfer-encoding") === "base64"
      ? Buffer.from(rest.replace(/\s+/g, ""), "base64")
      : Buffer.from(rest, "latin1");
  return { headers, body, parts: [] };
}

/** Every leaf part, depth first. */
export function leaves(entity: MimeEntity): MimeEntity[] {
  return entity.parts.length === 0 ? [entity] : entity.parts.flatMap(leaves);
}

export function partOfType(
  entity: MimeEntity,
  type: string,
): MimeEntity | undefined {
  return leaves(entity).find((p) =>
    (p.headers.get("content-type") ?? "").startsWith(type),
  );
}

function b64url(text: string | Buffer): string {
  return Buffer.from(text).toString("base64url");
}

export interface EmailSpec {
  id: string;
  threadId: string;
  from: string;
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  messageId?: string;
  references?: string;
  replyTo?: string;
  labelIds?: string[];
  headers?: Record<string, string>;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    bytes: Buffer;
    /** Serve through `attachments.get` instead of inline. */
    remote?: boolean;
  }>;
}

/** Build a Gmail API message (`format=full`) from a simple spec. */
export function gmailMessage(spec: EmailSpec): GmailMessage {
  const headers = [
    { name: "From", value: spec.from },
    { name: "To", value: spec.to ?? "bot@example.com" },
    { name: "Subject", value: spec.subject ?? "Hello" },
    {
      name: "Message-ID",
      value: spec.messageId ?? `<${spec.id}@mail.example.com>`,
    },
    ...(spec.references
      ? [{ name: "References", value: spec.references }]
      : []),
    ...(spec.replyTo ? [{ name: "Reply-To", value: spec.replyTo }] : []),
    ...Object.entries(spec.headers ?? {}).map(([name, value]) => ({
      name,
      value,
    })),
  ];
  const bodyParts = [
    ...(spec.text !== undefined
      ? [
          {
            mimeType: "text/plain",
            filename: "",
            body: { data: b64url(spec.text), size: spec.text.length },
          },
        ]
      : []),
    ...(spec.html !== undefined
      ? [
          {
            mimeType: "text/html",
            filename: "",
            body: { data: b64url(spec.html), size: spec.html.length },
          },
        ]
      : []),
  ];
  const attachmentParts = (spec.attachments ?? []).map((a, i) => ({
    mimeType: a.mimeType,
    filename: a.filename,
    body: a.remote
      ? { attachmentId: `att-${spec.id}-${i}`, size: a.bytes.length }
      : { data: b64url(a.bytes), size: a.bytes.length },
  }));
  return {
    id: spec.id,
    threadId: spec.threadId,
    labelIds: spec.labelIds ?? ["INBOX", "UNREAD"],
    internalDate: "1700000000000",
    payload: {
      mimeType: "multipart/mixed",
      headers,
      parts: [
        { mimeType: "multipart/alternative", parts: bodyParts },
        ...attachmentParts,
      ],
    },
  };
}

export interface SentMail {
  threadId: string;
  raw: Buffer;
  mime: MimeEntity;
}

/** Parse the multipart/related upload body the client sends. */
function parseUpload(
  contentType: string,
  body: Buffer,
): { threadId: string; raw: Buffer } {
  const boundary = /boundary=([^;]+)/.exec(contentType)![1]!;
  const text = body.toString("latin1");
  const sections = text.split(`--${boundary}`).slice(1, -1);
  const json = sections[0]!.slice(sections[0]!.indexOf("\r\n\r\n") + 4).trim();
  const rawSection = sections[1]!;
  const raw = rawSection
    .slice(rawSection.indexOf("\r\n\r\n") + 4)
    .replace(/\r\n$/, "");
  return {
    threadId: (JSON.parse(json) as { threadId: string }).threadId,
    raw: Buffer.from(raw, "latin1"),
  };
}

/**
 * An in-memory Gmail + Google OAuth backend behind a `fetch` function.
 * Tests add messages and history pages, then read what the adapter sent.
 */
export class FakeGmail {
  readonly email: string;
  historyId = "100";
  readonly messages = new Map<string, GmailMessage>();
  readonly attachments = new Map<string, Buffer>();
  /** History pages keyed by the page token they answer (`""` = first page). */
  historyPages = new Map<string, GmailHistoryPage>();
  historyStatus = 200;
  readonly sent: SentMail[] = [];
  readonly calls: string[] = [];
  readonly watchCalls: unknown[] = [];
  tokenRequests = 0;
  /** Answer the next Gmail call with 401 once. */
  failNextWithUnauthorized = false;
  jwks: unknown = { keys: [] };
  private sentCount = 0;

  constructor(email = "bot@example.com") {
    this.email = email;
  }

  addMessage(spec: EmailSpec): GmailMessage {
    const message = gmailMessage(spec);
    this.messages.set(spec.id, message);
    spec.attachments?.forEach((a, i) => {
      if (a.remote) this.attachments.set(`att-${spec.id}-${i}`, a.bytes);
    });
    return message;
  }

  /** One history page that adds these message ids. */
  setHistory(ids: string[], historyId: string): void {
    this.historyPages = new Map([
      [
        "",
        {
          historyId,
          history: ids.map((id, i) => ({
            id: String(Number(historyId) - ids.length + i + 1),
            messagesAdded: [
              {
                message: {
                  id,
                  threadId: this.messages.get(id)?.threadId ?? id,
                },
              },
            ],
          })),
        },
      ],
    ]);
  }

  readonly fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const method = init?.method ?? "GET";
    this.calls.push(`${method} ${url.pathname}${url.search}`);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });

    if (url.href === "https://oauth2.googleapis.com/token") {
      this.tokenRequests++;
      return json(200, {
        access_token: `token-${this.tokenRequests}`,
        expires_in: 3600,
      });
    }
    if (url.href === "https://www.googleapis.com/oauth2/v3/certs") {
      return new Response(JSON.stringify(this.jwks), {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=3600",
        },
      });
    }
    if (this.failNextWithUnauthorized) {
      this.failNextWithUnauthorized = false;
      return json(401, { error: { message: "expired" } });
    }
    const path = url.pathname.replace(/^\/(upload\/)?gmail\/v1\/users\/me/, "");
    if (path === "/profile") {
      return json(200, { emailAddress: this.email, historyId: this.historyId });
    }
    if (path === "/watch") {
      this.watchCalls.push(JSON.parse(String(init?.body)));
      return json(200, {
        historyId: this.historyId,
        expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
    }
    if (path === "/history") {
      if (this.historyStatus !== 200) {
        return json(this.historyStatus, { error: { message: "not found" } });
      }
      const page = this.historyPages.get(
        url.searchParams.get("pageToken") ?? "",
      );
      return json(200, page ?? { historyId: this.historyId });
    }
    if (path === "/messages/send") {
      const headers = new Headers(init?.headers);
      const upload = parseUpload(
        headers.get("content-type")!,
        Buffer.from(init!.body as Uint8Array),
      );
      this.sentCount++;
      this.sent.push({ ...upload, mime: parseMime(upload.raw) });
      return json(200, {
        id: `sent-${this.sentCount}`,
        threadId: upload.threadId,
      });
    }
    const attachment = /^\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(path);
    if (attachment) {
      const bytes = this.attachments.get(decodeURIComponent(attachment[2]!));
      return bytes
        ? json(200, { data: bytes.toString("base64url"), size: bytes.length })
        : json(404, {});
    }
    const message = /^\/messages\/([^/]+)$/.exec(path);
    if (message) {
      const found = this.messages.get(decodeURIComponent(message[1]!));
      return found
        ? json(200, found)
        : json(404, { error: { message: "not found" } });
    }
    const thread = /^\/threads\/([^/]+)$/.exec(path);
    if (thread) {
      const id = decodeURIComponent(thread[1]!);
      const messages = [...this.messages.values()].filter(
        (m) => m.threadId === id,
      );
      return messages.length ? json(200, { id, messages }) : json(404, {});
    }
    return json(404, { error: { message: `no route for ${url.pathname}` } });
  };
}

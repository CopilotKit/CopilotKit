import { EventType } from "@ag-ui/client";
import type {
  AgentSubscriber,
  Message,
  RunAgentParameters,
  RunAgentResult,
} from "@ag-ui/client";
import { FakeAgent } from "@copilotkit/channels-core";

/** One scripted run of the fake agent (the shape `FakeAgent` takes). */
export type FakeAgentScriptStep = (
  subscriber: AgentSubscriber,
) => void | Promise<void>;
import type {
  ResendReceivedAttachment,
  ResendReceivedEmail,
  ResendSendPayload,
} from "../client.js";
import { signWebhook } from "../svix.js";

export const WEBHOOK_SECRET =
  "whsec_" + Buffer.from("test-webhook-secret").toString("base64");
export const HOOK_URL = "https://bot.example.com/api/resend";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fake Resend API behind a `fetch` function. */
export function fakeResend() {
  const emails = new Map<string, ResendReceivedEmail>();
  const attachments = new Map<string, ResendReceivedAttachment[]>();
  const files = new Map<string, Uint8Array>();
  const sent: ResendSendPayload[] = [];
  const failNext: Array<() => Response> = [];
  let sentCount = 0;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const injected = failNext.shift();
    if (injected) return injected();
    if (url.hostname === "cdn.test") {
      const bytes = files.get(url.pathname.slice(1));
      return bytes
        ? new Response(bytes as BodyInit)
        : new Response("", { status: 404 });
    }
    if (method === "POST" && url.pathname === "/emails") {
      sent.push(JSON.parse(String(init?.body)) as ResendSendPayload);
      sentCount += 1;
      return json(200, { id: `sent-${sentCount}` });
    }
    const list = url.pathname.match(
      /^\/emails\/receiving\/([^/]+)\/attachments$/,
    );
    if (method === "GET" && list) {
      return json(200, {
        object: "list",
        data: attachments.get(list[1]!) ?? [],
      });
    }
    const one = url.pathname.match(/^\/emails\/receiving\/([^/]+)$/);
    if (method === "GET" && one) {
      const email = emails.get(one[1]!);
      return email
        ? json(200, email)
        : json(404, { name: "not_found", message: "Email not found" });
    }
    return json(404, {
      name: "not_found",
      message: `no route ${method} ${url.pathname}`,
    });
  }) as typeof globalThis.fetch;
  return { fetch, emails, attachments, files, sent, failNext };
}

/** A received email, as `GET /emails/receiving/{id}` returns it. */
export function receivedEmail(
  id: string,
  overrides: Partial<ResendReceivedEmail> & {
    headers?: Record<string, string>;
  } = {},
): ResendReceivedEmail {
  return {
    id,
    from: "ann@example.com",
    to: ["support@bot.example.com"],
    cc: [],
    received_for: [],
    subject: "Refund for order 1234",
    text: "Hi, I would like a refund.",
    html: null,
    message_id: `<${id}@mail.example.com>`,
    created_at: "2026-11-10T10:00:00.000Z",
    authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
    attachments: [],
    ...overrides,
    headers: { from: "Ann Lee <ann@example.com>", ...overrides.headers },
  };
}

/** The webhook Resend posts for a received email, signed with the test secret. */
export function webhookRequest(
  email: Pick<
    ResendReceivedEmail,
    "id" | "from" | "to" | "subject" | "message_id"
  >,
  opts: {
    secret?: string;
    type?: string;
    svixId?: string;
    timestamp?: number;
  } = {},
): Request {
  const body = JSON.stringify({
    type: opts.type ?? "email.received",
    created_at: "2026-11-10T10:00:01.000Z",
    data: {
      email_id: email.id,
      created_at: "2026-11-10T10:00:00.000Z",
      from: email.from,
      to: email.to,
      cc: [],
      bcc: [],
      received_for: [],
      message_id: email.message_id,
      subject: email.subject,
      attachments: [],
    },
  });
  const svixId = opts.svixId ?? `msg_${email.id}`;
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = signWebhook(
    opts.secret ?? WEBHOOK_SECRET,
    svixId,
    timestamp,
    body,
  );
  return new Request(HOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": svixId,
      "svix-timestamp": String(timestamp),
      "svix-signature": `v1,${signature}`,
    },
    body,
  });
}

/** Collects the work a handler starts, so tests can wait for it. */
export function workTracker() {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p);
    },
    async settle() {
      while (pending.length > 0) await pending.shift();
    },
  };
}

/** A step that makes the fake agent answer with one text message. */
export function say(messageId: string, text: string): FakeAgentScriptStep {
  return async (subscriber) => {
    const base = {
      messages: [],
      state: {},
      agent: undefined as never,
      input: undefined as never,
    };
    await subscriber.onTextMessageStartEvent?.({
      ...base,
      event: {
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
      },
    } as never);
    await subscriber.onTextMessageContentEvent?.({
      ...base,
      event: { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text },
      textMessageBuffer: text,
    } as never);
    await subscriber.onTextMessageEndEvent?.({
      ...base,
      event: { type: EventType.TEXT_MESSAGE_END, messageId },
      textMessageBuffer: text,
    } as never);
  };
}

/**
 * The core `FakeAgent`, plus a record of the messages it held on each run.
 * Clones share the script and the record, because Channels clones the agent
 * for every turn.
 */
export class RecordingAgent extends FakeAgent {
  constructor(
    readonly steps: FakeAgentScriptStep[],
    readonly seen: Message[][] = [],
  ) {
    super();
  }

  override async runAgent(
    parameters?: RunAgentParameters,
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    this.runAgentCalls += 1;
    this.seen.push(structuredClone(this.messages));
    const step = this.steps.shift();
    if (step && subscriber) await step(subscriber);
    void parameters;
    return { result: undefined, newMessages: [] };
  }

  override clone(): RecordingAgent {
    const cloned = new RecordingAgent(this.steps, this.seen);
    cloned.threadId = this.threadId;
    cloned.agentId = this.agentId;
    cloned.messages = structuredClone(this.messages);
    cloned.state = structuredClone(this.state);
    return cloned;
  }
}

/** Pull every `ck_action` link out of an email's HTML. */
export function actionLinks(html: string | undefined): string[] {
  return [...(html ?? "").matchAll(/href="([^"]*ck_action=[^"]*)"/g)].map((m) =>
    m[1]!.replace(/&amp;/g, "&"),
  );
}

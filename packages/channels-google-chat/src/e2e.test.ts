/**
 * End-to-end: the real adapter, the real channel engine, and a real AG-UI
 * agent, driven by signed HTTP webhooks.
 *
 * Only Google is replaced: a local HTTP server stands in for the Chat REST
 * API and records every call, and the two certificate downloads Google's
 * libraries make return this test's own key. Webhook tokens are real RS256
 * JWTs, verified by `google-auth-library` exactly as in production.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createSign, generateKeyPairSync } from "node:crypto";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/client";
import { OAuth2Client } from "google-auth-library";
import { Observable } from "rxjs";
import { createChannel } from "@copilotkit/channels-core";
import type { Channel } from "@copilotkit/channels-core";
import { Actions, Button } from "@copilotkit/channels-ui";
import { ChatClient, googleChat } from "./index.js";
import type { GoogleChatAdapter } from "./index.js";
import {
  addOnClick,
  addOnMention,
  legacyDm,
  legacyMention,
  legacySlash,
} from "./__fixtures__/events.js";

const PROJECT_NUMBER = "123456789";
const ENDPOINT = "https://bot.example.com/google-chat";
const CHAT_CERTS_URL =
  "https://www.googleapis.com/service_accounts/v1/metadata/x509/chat@system.gserviceaccount.com";

// ── Signing ──────────────────────────────────────────────────────────────
const google = generateKeyPairSync("rsa", { modulusLength: 2048 });
const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });
const GOOGLE_PEM = google.publicKey.export({ type: "spki", format: "pem" });

function signJwt(
  claims: Record<string, unknown>,
  key = google.privateKey,
): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "RS256", typ: "JWT", kid: "k1" });
  const body = b64({ iat: now, exp: now + 300, ...claims });
  const sig = createSign("RSA-SHA256")
    .update(`${head}.${body}`)
    .sign(key)
    .toString("base64url");
  return `${head}.${body}.${sig}`;
}
/** What Chat sends when the app's audience is "Project number". */
const projectNumberToken = (key = google.privateKey) =>
  signJwt({ iss: "chat@system.gserviceaccount.com", aud: PROJECT_NUMBER }, key);
/** What Chat sends when the audience is "HTTP endpoint URL". */
const endpointToken = () =>
  signJwt({
    iss: "https://accounts.google.com",
    aud: ENDPOINT,
    email: "chat@system.gserviceaccount.com",
    email_verified: true,
  });

// ── Fake Chat REST API ───────────────────────────────────────────────────
interface ApiCall {
  method: string;
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown>;
}
const calls: ApiCall[] = [];
let seq = 0;
const api = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.headers.authorization !== "Bearer test-access-token") {
      res.writeHead(401).end();
      return;
    }
    const body = chunks.length
      ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<
          string,
          unknown
        >)
      : {};
    const path = url.pathname.replace(/^\/v1\//, "");
    calls.push({
      method: req.method ?? "",
      path,
      query: Object.fromEntries(url.searchParams),
      body,
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.method === "POST") {
      const space = path.replace(/\/messages$/, "");
      const name = `${space}/messages/BOT${++seq}`;
      const thread =
        (body.thread as { name?: string } | undefined)?.name ??
        `${space}/threads/BOT${seq}`;
      res.end(JSON.stringify({ name, thread: { name: thread } }));
    } else {
      res.end("{}");
    }
  });
});

// ── A real AG-UI agent ───────────────────────────────────────────────────
/** Every message list an agent run received, to check history replay. */
const runs: Message[][] = [];

/** Streams "You said: **<last user text>**" over AG-UI, in three deltas. */
class EchoAgent extends AbstractAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    runs.push(structuredClone(input.messages));
    const last = input.messages.filter((m) => m.role === "user").at(-1);
    const said = typeof last?.content === "string" ? last.content : "";
    const messageId = `msg-${runs.length}`;
    return new Observable<BaseEvent>((sub) => {
      const emit = (e: Record<string, unknown>) => sub.next(e as BaseEvent);
      emit({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      });
      emit({
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
      });
      for (const delta of ["You said: ", "**", `${said}**`]) {
        emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta });
      }
      emit({ type: EventType.TEXT_MESSAGE_END, messageId });
      emit({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      });
      sub.complete();
    });
  }
  override clone(): EchoAgent {
    const c = new EchoAgent();
    c.threadId = this.threadId;
    c.messages = structuredClone(this.messages);
    return c;
  }
}

// ── Wiring ───────────────────────────────────────────────────────────────
let adapter: GoogleChatAdapter;
let channel: Channel;
let webhook: Server;
let webhookUrl: string;
const picked: unknown[] = [];

async function send(body: unknown, token: string): Promise<number> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return res.status;
}

/** Wait until `pred` holds over the recorded API calls. */
async function until(pred: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const posts = () => calls.filter((c) => c.method === "POST");
const patches = () => calls.filter((c) => c.method === "PATCH");

beforeAll(async () => {
  // Google's certificate downloads return this test's key.
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
    String(input) === CHAT_CERTS_URL
      ? Promise.resolve(Response.json({ k1: GOOGLE_PEM }))
      : realFetch(input, init),
  );
  vi.spyOn(
    OAuth2Client.prototype,
    "getFederatedSignonCertsAsync",
  ).mockResolvedValue({
    certs: { k1: GOOGLE_PEM as string },
    format: "PEM",
  } as Awaited<ReturnType<OAuth2Client["getFederatedSignonCertsAsync"]>>);

  await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
  const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}/v1`;

  adapter = googleChat({
    googleChatProjectNumber: PROJECT_NUMBER,
    endpointUrl: ENDPOINT,
    path: "/google-chat",
  });
  adapter.chatClient = new ChatClient({
    apiUrl,
    tokenProvider: { getToken: async () => "test-access-token" },
  });

  channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
    agent: new EchoAgent(),
  });
  channel.onMention(async ({ thread }) => {
    await thread.runAgent();
  });
  channel.onCommand("summarize", async ({ thread }) => {
    const choice = await thread.awaitChoice<string>(
      Actions({
        children: [
          Button({ value: "red", children: "Red" }),
          Button({ value: "blue", children: "Blue" }),
        ],
      }),
    );
    picked.push(choice);
    await thread.post(`You picked ${choice}`);
  });
  await channel.ɵruntime.start();

  webhook = createServer(adapter.nodeHandler);
  await new Promise<void>((r) => webhook.listen(0, "127.0.0.1", r));
  webhookUrl = `http://127.0.0.1:${(webhook.address() as AddressInfo).port}/google-chat`;
});

afterAll(async () => {
  await channel?.ɵruntime.stop();
  await new Promise((r) => webhook?.close(r));
  await new Promise((r) => api.close(r));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Google Chat end to end", () => {
  it("rejects a webhook signed by anyone but Google", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await send(legacyMention, projectNumberToken(attacker.privateKey)),
    ).toBe(401);
    expect(await send(legacyMention, "not-a-jwt")).toBe(401);
    const res = await fetch(webhookUrl, {
      method: "POST",
      body: JSON.stringify(legacyMention),
    });
    expect(res.status).toBe(401);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(0);
    expect(runs).toHaveLength(0);
  });

  it("answers an @-mention in a space thread, streaming by editing one message", async () => {
    expect(await send(legacyMention, projectNumberToken())).toBe(200);
    await until(
      () => patches().some((p) => p.body.text === "You said: *what is 2+2?*"),
      "the streamed reply",
    );

    const [post] = posts();
    expect(post).toMatchObject({
      path: "spaces/ROOM1/messages",
      query: { messageReplyOption: "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD" },
      body: { thread: { name: "spaces/ROOM1/threads/T1" } },
    });
    // Every edit targets the one message the placeholder created.
    const created = "spaces/ROOM1/messages/BOT1";
    expect(patches().every((p) => p.path === created)).toBe(true);
    expect(patches().every((p) => p.query.updateMask === "text")).toBe(true);
    // The agent saw the user's words, with the mention stripped.
    expect(runs[0]!.at(-1)).toMatchObject({
      role: "user",
      content: "what is 2+2?",
    });
  });

  it("accepts the add-on envelope with an endpoint-URL token and replays the thread's history", async () => {
    const before = calls.length;
    expect(await send(addOnMention, endpointToken())).toBe(200);
    await until(
      () => patches().some((p) => p.body.text === "You said: *hi*"),
      "the add-on reply",
    );
    expect(calls[before]).toMatchObject({
      method: "POST",
      body: { thread: { name: "spaces/ROOM1/threads/T1" } },
    });
    // Same thread as the first mention, so the agent got that exchange too.
    const history = runs[1]!.map((m) => [m.role, m.content]);
    expect(history).toEqual([
      ["user", "what is 2+2?"],
      ["assistant", "You said: **what is 2+2?**"],
      ["user", "hi"],
    ]);
  });

  it("replies in a direct message without a thread", async () => {
    const before = calls.length;
    expect(await send(legacyDm, projectNumberToken())).toBe(200);
    await until(
      () => patches().some((p) => p.body.text === "You said: *hello there*"),
      "the DM reply",
    );
    expect(calls[before]).toMatchObject({
      method: "POST",
      path: "spaces/DM1/messages",
      query: {},
    });
    expect(calls[before]!.body).not.toHaveProperty("thread");
  });

  it("runs awaitChoice: posts a card, and a click on it resumes the handler", async () => {
    const before = calls.length;
    expect(await send(legacySlash, projectNumberToken())).toBe(200);
    await until(() => calls.length > before, "the picker card");

    const card = calls[before]!;
    expect(card).toMatchObject({
      method: "POST",
      path: "spaces/ROOM1/messages",
      body: { thread: { name: "spaces/ROOM1/threads/T1" } },
    });
    // Buttons route to the endpoint URL and carry the action id and value.
    const buttons = (
      card.body.cardsV2 as Array<{
        card: {
          sections: Array<{
            widgets: Array<{
              buttonList?: {
                buttons: Array<{
                  text: string;
                  onClick: {
                    action: {
                      function: string;
                      parameters: { key: string; value: string }[];
                    };
                  };
                }>;
              };
            }>;
          }>;
        };
      }>
    )[0]!.card.sections[0]!.widgets[0]!.buttonList!.buttons;
    expect(buttons.map((b) => b.text)).toEqual(["Red", "Blue"]);
    for (const b of buttons) expect(b.onClick.action.function).toBe(ENDPOINT);
    const blue = Object.fromEntries(
      buttons[1]!.onClick.action.parameters.map((p) => [p.key, p.value]),
    );
    expect(blue.value).toBe('"blue"');

    // Ada clicks "Blue" — delivered the way an add-on Chat app delivers it.
    const click = addOnClick(blue);
    click.chat.buttonClickedPayload.message.name = `${card.path}/${"BOT" + seq}`;
    expect(await send(click, endpointToken())).toBe(200);

    await until(() => picked.length === 1, "the choice");
    expect(picked).toEqual(["blue"]);
    await until(
      () => posts().some((p) => p.body.text === "You picked blue"),
      "the follow-up post",
    );
    expect(posts().at(-1)!.body).toMatchObject({
      text: "You picked blue",
      thread: { name: "spaces/ROOM1/threads/T1" },
    });
  });
});

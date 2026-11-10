import { afterEach, describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import type { AgentSubscriber } from "@ag-ui/client";
import { FakeAgent, createChannel } from "@copilotkit/channels-core";
import type { Channel } from "@copilotkit/channels-core";
import { Actions, Button, Message, Section } from "@copilotkit/channels-ui";
import { gmail } from "../adapter.js";
import type { GmailAdapter } from "../adapter.js";
import { FakeGmail, partOfType } from "./fake-gmail.js";
import { signer } from "./oidc-signer.js";

const AUDIENCE = "https://bot.test/gmail";
const SECRET = "s".repeat(32);

let channel: Channel | undefined;

afterEach(async () => {
  await channel?.stop();
  channel = undefined;
  vi.restoreAllMocks();
});

/** A scripted agent step that writes one text message. */
function say(text: string, messageId = "a1") {
  return async (subscriber: AgentSubscriber) => {
    const params = {
      messages: [],
      state: {},
      agent: undefined,
      input: undefined,
    } as never;
    await subscriber.onTextMessageStartEvent?.({
      ...(params as object),
      event: {
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
      },
    } as never);
    await subscriber.onTextMessageContentEvent?.({
      ...(params as object),
      event: { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text },
      textMessageBuffer: text,
    } as never);
    await subscriber.onTextMessageEndEvent?.({
      ...(params as object),
      event: { type: EventType.TEXT_MESSAGE_END, messageId },
      textMessageBuffer: text,
    } as never);
  };
}

type FakeAgentScriptStep = NonNullable<
  ConstructorParameters<typeof FakeAgent>[0]
>[number];

/** A FakeAgent that records the messages each run starts with, across clones. */
class RecordingAgent extends FakeAgent {
  constructor(
    script: FakeAgentScriptStep[] = [],
    readonly runs: Array<Array<{ role: string; content: unknown }>> = [],
  ) {
    super(script);
  }

  override async runAgent(
    ...args: Parameters<FakeAgent["runAgent"]>
  ): ReturnType<FakeAgent["runAgent"]> {
    this.runs.push(
      this.messages.map((m) => ({ role: m.role, content: m.content })),
    );
    return super.runAgent(...args);
  }

  override clone(): RecordingAgent {
    const script = (this as unknown as { script: FakeAgentScriptStep[] })
      .script;
    const cloned = new RecordingAgent(script, this.runs);
    cloned.messages = structuredClone(this.messages);
    return cloned;
  }
}

function setup(
  configure: (ch: Channel) => void,
  agent: FakeAgent = new RecordingAgent(),
) {
  const fake = new FakeGmail();
  fake.jwks = signer.jwks;
  const adapter = gmail({
    oauth: { clientId: "id", clientSecret: "secret", refreshToken: "refresh" },
    topicName: "projects/p/topics/gmail",
    pubsubAuth: {
      audience: AUDIENCE,
      serviceAccountEmail: "push@p.iam.gserviceaccount.com",
    },
    actions: { baseUrl: AUDIENCE, secret: SECRET },
    fetch: fake.fetch,
  });
  channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
    agent: () => agent,
  });
  configure(channel);
  return { fake, adapter, agent };
}

/** A Pub/Sub push, signed like Google signs it. */
function push(historyId: string, email = "bot@example.com"): Request {
  const nowS = Math.floor(Date.now() / 1000);
  const token = signer.token({
    iss: "https://accounts.google.com",
    aud: AUDIENCE,
    email: "push@p.iam.gserviceaccount.com",
    email_verified: true,
    iat: nowS,
    exp: nowS + 3600,
  });
  return new Request(AUDIENCE, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: {
        data: Buffer.from(
          JSON.stringify({ emailAddress: email, historyId }),
        ).toString("base64"),
        messageId: `ps-${historyId}`,
      },
      subscription: "projects/p/subscriptions/gmail-push",
    }),
  });
}

/** A thread: Jane wrote, the bot answered, Jane replied. */
function seedThread(fake: FakeGmail): void {
  fake.addMessage({
    id: "m0",
    threadId: "t1",
    from: "Jane Doe <jane@example.org>",
    subject: "Deploy",
    text: "Can you deploy?",
  });
  fake.addMessage({
    id: "b0",
    threadId: "t1",
    from: "bot@example.com",
    to: "jane@example.org",
    subject: "Re: Deploy",
    text: "Which environment?",
    labelIds: ["SENT"],
  });
  fake.addMessage({
    id: "m1",
    threadId: "t1",
    from: "Jane Doe <jane@example.org>",
    subject: "Re: Deploy",
    references: "<m0@mail.example.com> <b0@mail.example.com>",
    text: "Production please.\n\nOn Mon, Bot <bot@example.com> wrote:\n> Which environment?",
  });
  fake.setHistory(["m1"], "110");
}

/** The first link in an email's text part that starts with the handler URL. */
function linkIn(text: string): string {
  const match = /https:\/\/bot\.test\/gmail\?a=\S+/.exec(text);
  if (!match) throw new Error(`no action link in: ${text}`);
  return match[0];
}

async function click(adapter: GmailAdapter, link: string): Promise<Response> {
  const token = new URL(link).searchParams.get("a")!;
  return adapter.handler(
    new Request(link, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ a: token }).toString(),
    }),
  );
}

describe("gmail adapter end to end", () => {
  it("answers a pushed email with one threaded reply from the agent", async () => {
    const agent = new RecordingAgent([say("Deploying **production** now.")]);
    const { fake, adapter } = setup(
      (ch) =>
        ch.onMention(async ({ thread }) => {
          await thread.runAgent();
        }),
      agent,
    );
    seedThread(fake);
    await channel!.start();
    expect(fake.watchCalls).toEqual([
      expect.objectContaining({
        topicName: "projects/p/topics/gmail",
        labelIds: ["INBOX"],
      }),
    ]);

    const res = await adapter.handler(push("110"));

    expect(res.status).toBe(204);
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
    const [sent] = fake.sent;
    expect(sent!.threadId).toBe("t1");
    expect(sent!.mime.headers.get("to")).toBe("jane@example.org");
    expect(sent!.mime.headers.get("subject")).toBe("Re: Deploy");
    expect(sent!.mime.headers.get("in-reply-to")).toBe("<m1@mail.example.com>");
    expect(sent!.mime.headers.get("references")).toBe(
      "<m0@mail.example.com> <b0@mail.example.com> <m1@mail.example.com>",
    );
    expect(partOfType(sent!.mime, "text/plain")!.body.toString()).toBe(
      "Deploying **production** now.",
    );
    expect(partOfType(sent!.mime, "text/html")!.body.toString()).toContain(
      "<strong>production</strong>",
    );
    // The agent saw the thread so far, then the new email without the quote.
    expect(agent.runs[0]!.map((m) => [m.role, m.content])).toEqual([
      ["user", "Can you deploy?"],
      ["assistant", "Which environment?"],
      ["user", "Production please."],
    ]);
  });

  it("routes a signed link click to the button's onClick and replies in the thread", async () => {
    const clicks: Array<{ value: unknown; actor: string }> = [];
    const { fake, adapter } = setup((ch) => {
      ch.onMention(async ({ thread }) => {
        await thread.post(
          Message({
            children: [
              Section({ children: "Deploy to production?" }),
              Actions({
                children: Button({
                  value: { env: "prod" },
                  onClick: async ({ action, actor, thread: t }) => {
                    clicks.push({ value: action.value, actor: actor.id });
                    await t.post("Deployed.");
                  },
                  children: "Deploy",
                }),
              }),
            ],
          }),
        );
      });
    });
    seedThread(fake);
    await channel!.start();
    await adapter.handler(push("110"));
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
    const link = linkIn(
      partOfType(fake.sent[0]!.mime, "text/plain")!.body.toString(),
    );
    expect(
      partOfType(fake.sent[0]!.mime, "text/html")!.body.toString(),
    ).toContain(">Deploy</a>");

    // Opening the link only shows a confirm page.
    const opened = await adapter.handler(new Request(link));
    expect(opened.status).toBe(200);
    expect(await opened.text()).toContain('<form method="post">');
    expect(clicks).toEqual([]);

    const confirmed = await click(adapter, link);
    expect(confirmed.status).toBe(200);
    await vi.waitFor(() => expect(clicks).toHaveLength(1));
    expect(clicks[0]).toEqual({
      value: { env: "prod" },
      actor: "jane@example.org",
    });
    await vi.waitFor(() => expect(fake.sent).toHaveLength(2));
    const reply = fake.sent[1]!;
    expect(reply.threadId).toBe("t1");
    expect(reply.mime.headers.get("in-reply-to")).toBe("<m1@mail.example.com>");
    expect(partOfType(reply.mime, "text/plain")!.body.toString()).toBe(
      "Deployed.",
    );

    // The link works once.
    expect((await click(adapter, link)).status).toBe(409);
    // A changed link is refused.
    expect((await click(adapter, `${link.slice(0, -3)}abc`)).status).toBe(400);
    expect(clicks).toHaveLength(1);
  });

  it("answers awaitChoice through a link", async () => {
    const answers: unknown[] = [];
    const { fake, adapter } = setup((ch) => {
      ch.onMention(async ({ thread }) => {
        const choice = await thread.awaitChoice<string>(
          Message({
            children: [
              Section({ children: "Which size?" }),
              Actions({
                children: [
                  Button({ value: "small", children: "Small" }),
                  Button({ value: "large", children: "Large" }),
                ],
              }),
            ],
          }),
        );
        answers.push(choice);
        await thread.post(`You chose ${choice}.`);
      });
    });
    seedThread(fake);
    await channel!.start();
    await adapter.handler(push("110"));
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
    const text = partOfType(fake.sent[0]!.mime, "text/plain")!.body.toString();
    const large = /Large: (\S+)/.exec(text)![1]!;

    await click(adapter, large);

    await vi.waitFor(() => expect(answers).toEqual(["large"]));
    await vi.waitFor(() => expect(fake.sent).toHaveLength(2));
    expect(partOfType(fake.sent[1]!.mime, "text/plain")!.body.toString()).toBe(
      "You chose large.",
    );
  });

  it("refuses a push without a valid Pub/Sub token and reads no mail", async () => {
    const { fake, adapter } = setup((ch) => ch.onMention(async () => {}));
    seedThread(fake);
    await channel!.start();
    const forged = push("110");
    const res = await adapter.handler(
      new Request(forged, {
        headers: {
          authorization: "Bearer a.b.c",
          "content-type": "application/json",
        },
      }),
    );
    expect(res.status).toBe(401);
    expect(fake.calls.some((c) => c.includes("/history"))).toBe(false);
  });
});

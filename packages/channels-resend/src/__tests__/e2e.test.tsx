/** @jsxImportSource @copilotkit/channels-ui */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChannel } from "@copilotkit/channels-core";
import type { Channel } from "@copilotkit/channels-core";
import { Actions, Button, Message, Section } from "@copilotkit/channels-ui";
import { resend } from "../adapter.js";
import type { ResendAdapter } from "../adapter.js";
import {
  HOOK_URL,
  RecordingAgent,
  WEBHOOK_SECRET,
  actionLinks,
  fakeResend,
  receivedEmail,
  say,
  webhookRequest,
  workTracker,
} from "./helpers.js";
import type { FakeAgentScriptStep } from "./helpers.js";

let channel: Channel | undefined;

afterEach(async () => {
  await channel?.stop();
  channel = undefined;
  vi.restoreAllMocks();
});

async function setup(
  script: FakeAgentScriptStep[],
  configure: (channel: Channel) => void,
) {
  const api = fakeResend();
  const work = workTracker();
  const adapter: ResendAdapter = resend({
    apiKey: "re_test",
    from: "Support <support@bot.example.com>",
    webhookSecret: WEBHOOK_SECRET,
    actions: { baseUrl: HOOK_URL, secret: "e2e-link-secret" },
    fetch: api.fetch,
    waitUntil: work.waitUntil,
  });
  const agent = new RecordingAgent(script);
  channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
    agent,
  });
  configure(channel);
  await channel.start();

  const deliver = async (email: ReturnType<typeof receivedEmail>) => {
    api.emails.set(email.id, email);
    const response = await adapter.handler(webhookRequest(email));
    expect(response.status).toBe(200);
    await work.settle();
  };
  return { adapter, agent, api, work, deliver };
}

describe("resend adapter end to end", () => {
  it("answers a signed webhook with one threaded reply email", async () => {
    const { agent, api, deliver } = await setup(
      [
        say("a1", "Sure. Which **order** is it?"),
        say("a2", "Refund issued for 1234."),
      ],
      (ch) =>
        ch.onMention(async ({ thread }) => {
          await thread.runAgent();
        }),
    );

    await deliver(receivedEmail("e1"));

    expect(api.sent).toHaveLength(1);
    const first = api.sent[0]!;
    expect(first).toMatchObject({
      from: '"Support" <support@bot.example.com>',
      to: ['"Ann Lee" <ann@example.com>'],
      subject: "Re: Refund for order 1234",
      headers: {
        "In-Reply-To": "<e1@mail.example.com>",
        References: "<e1@mail.example.com>",
      },
      text: "Sure. Which order is it?",
    });
    expect(first.html).toContain("<strong>order</strong>");
    expect(agent.seen[0]).toEqual([
      {
        id: "user-e1",
        role: "user",
        content: "Subject: Refund for order 1234\n\nHi, I would like a refund.",
      },
    ]);

    // Ann replies to the bot's email. Her client threads it on our reply,
    // whose Message-ID Resend assigned, so only References links it back.
    await deliver(
      receivedEmail("e2", {
        subject: "Re: Refund for order 1234",
        text: "Order 1234.\n\nOn Mon, Nov 10, 2026 Support <support@bot.example.com> wrote:\n> Sure. Which order is it?",
        headers: {
          "In-Reply-To": "<sent-1@resend.example>",
          References: "<e1@mail.example.com> <sent-1@resend.example>",
        },
      }),
    );

    expect(api.sent).toHaveLength(2);
    expect(api.sent[1]).toMatchObject({
      subject: "Re: Refund for order 1234",
      headers: {
        "In-Reply-To": "<e2@mail.example.com>",
        References:
          "<e1@mail.example.com> <sent-1@resend.example> <e2@mail.example.com>",
      },
      text: "Refund issued for 1234.",
    });
    // The agent saw the whole thread: no quoted text, and the inbound turn once.
    expect(agent.seen[1]!.map((m) => [m.role, m.content])).toEqual([
      ["user", "Subject: Refund for order 1234\n\nHi, I would like a refund."],
      ["assistant", "Sure. Which order is it?"],
      ["user", "Order 1234."],
    ]);
  });

  it("runs a button's onClick from a signed link", async () => {
    const clicks: Array<{ value: unknown; actor: string }> = [];
    const { api, adapter, work, deliver } = await setup([], (ch) =>
      ch.onMention(async ({ thread }) => {
        await thread.post(
          <Message>
            <Section>Approve the refund?</Section>
            <Actions>
              <Button
                value={{ approved: true }}
                onClick={async ({ thread: t, action, actor }) => {
                  clicks.push({ value: action.value, actor: actor.id });
                  await t.post("Refund approved.");
                }}
              >
                Approve
              </Button>
            </Actions>
          </Message>,
        );
      }),
    );

    await deliver(receivedEmail("e1"));
    expect(api.sent).toHaveLength(1);
    const [link] = actionLinks(api.sent[0]!.html);
    expect(link).toBeDefined();
    expect(api.sent[0]!.text).toContain(`Approve: ${link}`);

    // Opening the link (as a mail scanner would) only shows the confirmation.
    const confirm = await adapter.handler(new Request(link!));
    await work.settle();
    expect(confirm.status).toBe(200);
    expect(clicks).toEqual([]);

    const done = await adapter.handler(new Request(link!, { method: "POST" }));
    await work.settle();
    expect(done.status).toBe(200);
    expect(clicks).toEqual([
      { value: { approved: true }, actor: "ann@example.com" },
    ]);
    expect(api.sent).toHaveLength(2);
    expect(api.sent[1]).toMatchObject({
      to: ['"Ann Lee" <ann@example.com>'],
      subject: "Re: Refund for order 1234",
      headers: { "In-Reply-To": "<e1@mail.example.com>" },
      text: "Refund approved.",
    });

    // The same link does not run twice.
    const replay = await adapter.handler(
      new Request(link!, { method: "POST" }),
    );
    await work.settle();
    expect(replay.status).toBe(409);
    expect(clicks).toHaveLength(1);
  });

  it("answers awaitChoice from a signed link", async () => {
    let chosen: unknown;
    const { api, adapter, work } = await setup([], (ch) =>
      ch.onMention(async ({ thread }) => {
        chosen = await thread.awaitChoice(
          <Message>
            <Section>Ship by?</Section>
            <Actions>
              <Button value="ground">Ground</Button>
              <Button value="air">Air</Button>
            </Actions>
          </Message>,
        );
        await thread.post(`Shipping by ${String(chosen)}.`);
      }),
    );

    const email = receivedEmail("e1");
    api.emails.set(email.id, email);
    await adapter.handler(webhookRequest(email));
    await vi.waitFor(() => expect(api.sent).toHaveLength(1));
    const links = actionLinks(api.sent[0]!.html);
    expect(links).toHaveLength(2);

    await adapter.handler(new Request(links[1]!, { method: "POST" }));
    await work.settle();
    expect(chosen).toBe("air");
    expect(api.sent[1]!.text).toBe("Shipping by air.");
  });
});

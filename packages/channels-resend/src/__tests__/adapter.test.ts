import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  IncomingTurn,
  IngressSink,
  InteractionEvent,
} from "@copilotkit/channels-core";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { resend } from "../adapter.js";
import type { ResendAdapter } from "../adapter.js";
import { signActionLink } from "../action-links.js";
import type { ResendAdapterOptions, ResendReplyTarget } from "../types.js";
import {
  HOOK_URL,
  WEBHOOK_SECRET,
  actionLinks,
  fakeResend,
  receivedEmail,
  webhookRequest,
  workTracker,
} from "./helpers.js";

const LINK_SECRET = "link-secret-for-tests";

let adapter: ResendAdapter | undefined;

afterEach(async () => {
  await adapter?.stop();
  adapter = undefined;
  vi.restoreAllMocks();
});

async function setup(
  options: Partial<ResendAdapterOptions> = {},
  start = true,
) {
  const api = fakeResend();
  const work = workTracker();
  const turns: IncomingTurn[] = [];
  const interactions: InteractionEvent[] = [];
  adapter = resend({
    apiKey: "re_test",
    from: "Support <support@bot.example.com>",
    webhookSecret: WEBHOOK_SECRET,
    fetch: api.fetch,
    waitUntil: work.waitUntil,
    ...options,
  });
  const sink = {
    onTurn: (t: IncomingTurn) => void turns.push(t),
    onInteraction: (e: InteractionEvent) => void interactions.push(e),
  } as unknown as IngressSink;
  if (start) await adapter.start(sink);
  return { adapter, api, work, turns, interactions };
}

async function deliver(
  ctx: Awaited<ReturnType<typeof setup>>,
  email: ReturnType<typeof receivedEmail>,
  opts: Parameters<typeof webhookRequest>[1] = {},
) {
  ctx.api.emails.set(email.id, email);
  const response = await ctx.adapter.handler(webhookRequest(email, opts));
  await ctx.work.settle();
  return response;
}

describe("webhook ingress", () => {
  it("answers 503 before the channel starts", async () => {
    const ctx = await setup({}, false);
    const response = await ctx.adapter.handler(
      webhookRequest(receivedEmail("e1")),
    );
    expect(response.status).toBe(503);
  });

  it("rejects a webhook with a bad signature", async () => {
    const ctx = await setup();
    const other = "whsec_" + Buffer.from("not the secret").toString("base64");
    const response = await deliver(ctx, receivedEmail("e1"), { secret: other });
    expect(response.status).toBe(401);
    expect(ctx.turns).toEqual([]);
  });

  it("rejects a replayed webhook with an old timestamp", async () => {
    const ctx = await setup();
    const response = await deliver(ctx, receivedEmail("e1"), {
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    });
    expect(response.status).toBe(401);
  });

  it("ignores other event types", async () => {
    const ctx = await setup();
    const response = await deliver(ctx, receivedEmail("e1"), {
      type: "email.delivered",
    });
    expect(response.status).toBe(200);
    expect(ctx.turns).toEqual([]);
  });

  it("turns a received email into a mentioned turn keyed by its thread", async () => {
    const ctx = await setup();
    const response = await deliver(ctx, receivedEmail("e1"));
    expect(response.status).toBe(200);
    expect(ctx.turns).toHaveLength(1);
    const turn = ctx.turns[0]!;
    expect(turn).toMatchObject({
      conversationKey: "resend:e1@mail.example.com",
      platform: "resend",
      eventId: "e1",
      userText: "Subject: Refund for order 1234\n\nHi, I would like a refund.",
      actor: {
        id: "ann@example.com",
        kind: "human",
        email: "ann@example.com",
        name: "Ann Lee",
      },
      operation: { kind: "created", logicalMessageId: "e1", mentioned: true },
    });
    expect(turn.replyTarget).toMatchObject({
      to: { address: "ann@example.com", name: "Ann Lee" },
      subject: "Re: Refund for order 1234",
      inReplyTo: "<e1@mail.example.com>",
      references: ["<e1@mail.example.com>"],
    });
  });

  it("puts a reply in the same conversation, without the quoted history", async () => {
    const ctx = await setup();
    await deliver(ctx, receivedEmail("e1"));
    await deliver(
      ctx,
      receivedEmail("e2", {
        subject: "Re: Refund for order 1234",
        text: "Order 1234, thanks.\n\nOn Mon, Nov 10, 2026 Support <support@bot.example.com> wrote:\n> Which order?",
        headers: {
          "In-Reply-To": "<bot-reply@resend.example>",
          References: "<e1@mail.example.com> <bot-reply@resend.example>",
        },
      }),
    );
    expect(ctx.turns.map((t) => t.conversationKey)).toEqual([
      "resend:e1@mail.example.com",
      "resend:e1@mail.example.com",
    ]);
    expect(ctx.turns[1]!.userText).toBe("Order 1234, thanks.");
    expect((ctx.turns[1]!.replyTarget as ResendReplyTarget).references).toEqual(
      [
        "<e1@mail.example.com>",
        "<bot-reply@resend.example>",
        "<e2@mail.example.com>",
      ],
    );
  });

  it("handles each email id once, even when Resend retries the webhook", async () => {
    const ctx = await setup();
    const email = receivedEmail("e1");
    await deliver(ctx, email, { svixId: "msg_1" });
    const again = await deliver(ctx, email, { svixId: "msg_2" });
    expect(await again.json()).toEqual({ ignored: "duplicate" });
    expect(ctx.turns).toHaveLength(1);
  });

  it("skips email from the bot's own address", async () => {
    const ctx = await setup();
    await deliver(
      ctx,
      receivedEmail("e1", {
        from: "SUPPORT@bot.example.com",
        headers: { from: "Support <SUPPORT@bot.example.com>" },
      }),
    );
    expect(ctx.turns).toEqual([]);
  });

  it("handles only allowed recipients when a filter is set", async () => {
    const ctx = await setup({ allowedRecipients: ["Help@bot.example.com"] });
    await deliver(ctx, receivedEmail("e1"));
    await deliver(ctx, receivedEmail("e2", { to: ["help@bot.example.com"] }));
    expect(ctx.turns.map((t) => t.eventId)).toEqual(["e2"]);
  });

  it("skips email that failed DMARC, and can require a DMARC pass", async () => {
    const ctx = await setup();
    await deliver(
      ctx,
      receivedEmail("e1", { authentication: { dmarc: "fail" } }),
    );
    await deliver(ctx, receivedEmail("e2", { authentication: null }));
    expect(ctx.turns.map((t) => t.eventId)).toEqual(["e2"]);

    const strict = await setup({ requireDmarcPass: true });
    await deliver(
      strict,
      receivedEmail("e3", { authentication: { dmarc: "none" } }),
    );
    expect(strict.turns).toEqual([]);
  });

  it("answers 502 when the email cannot be read, so Resend's retry is handled", async () => {
    const ctx = await setup();
    const email = receivedEmail("e1");
    ctx.api.failNext.push(() => new Response("{}", { status: 400 }));
    const first = await deliver(ctx, email);
    expect(first.status).toBe(502);
    const retry = await deliver(ctx, email);
    expect(retry.status).toBe(200);
    expect(ctx.turns).toHaveLength(1);
  });

  it("uses the HTML body when there is no text part", async () => {
    const ctx = await setup();
    await deliver(
      ctx,
      receivedEmail("e1", {
        text: null,
        html: '<div>Please <b>cancel</b> it.</div><div class="gmail_quote">old</div>',
        headers: { "in-reply-to": "<x@y>" },
      }),
    );
    expect(ctx.turns[0]!.userText).toBe("Please cancel it.");
  });

  it("passes attachments to the agent as content parts", async () => {
    const ctx = await setup();
    ctx.api.attachments.set("e1", [
      {
        id: "a1",
        filename: "receipt.png",
        content_type: "image/png",
        content_disposition: "attachment",
        size: 3,
        download_url: "https://cdn.test/a1",
      },
    ]);
    ctx.api.files.set("a1", new Uint8Array([1, 2, 3]));
    await deliver(
      ctx,
      receivedEmail("e1", {
        attachments: [
          { id: "a1", filename: "receipt.png", content_type: "image/png" },
        ],
      }),
    );
    expect(ctx.turns[0]!.contentParts).toEqual([
      {
        type: "text",
        text: "Subject: Refund for order 1234\n\nHi, I would like a refund.",
      },
      {
        type: "image",
        source: { type: "data", value: "AQID", mimeType: "image/png" },
      },
    ]);
  });
});

async function* helloChunks() {
  yield "Hello ";
  yield "**there**";
}

describe("outbound email", () => {
  const ir: ChannelNode[] = [{ type: "text", props: { value: "Done." } }];

  it("replies in the thread, with header-safe values", async () => {
    const ctx = await setup({ replyTo: "Help <help@bot.example.com>" });
    await deliver(
      ctx,
      receivedEmail("e1", {
        subject: "Hello\r\nBcc: victim@example.com",
        headers: { from: '"Eve\r\nBcc: x@y.com" <eve@example.com>' },
        from: "eve@example.com",
      }),
    );
    const turn = ctx.turns[0]!;
    await ctx.adapter.post(turn.replyTarget, ir);
    expect(ctx.api.sent).toHaveLength(1);
    const email = ctx.api.sent[0]!;
    expect(email).toMatchObject({
      from: '"Support" <support@bot.example.com>',
      to: ['"Eve Bcc: x@y.com" <eve@example.com>'],
      subject: "Re: Hello Bcc: victim@example.com",
      reply_to: ['"Help" <help@bot.example.com>'],
      headers: {
        "In-Reply-To": "<e1@mail.example.com>",
        References: "<e1@mail.example.com>",
      },
      text: "Done.",
    });
    for (const value of [
      email.subject,
      ...email.to,
      ...Object.values(email.headers ?? {}),
    ]) {
      expect(value).not.toMatch(/[\r\n]/);
    }
  });

  it("sends a stream as one email", async () => {
    const ctx = await setup();
    await deliver(ctx, receivedEmail("e1"));
    await ctx.adapter.stream(ctx.turns[0]!.replyTarget, helloChunks());
    expect(ctx.api.sent).toHaveLength(1);
    expect(ctx.api.sent[0]!.text).toBe("Hello there");
    expect(ctx.api.sent[0]!.html).toContain("<strong>there</strong>");
  });

  it("sends a file as an attachment and refuses files over Resend's limit", async () => {
    const ctx = await setup();
    await deliver(ctx, receivedEmail("e1"));
    const target = ctx.turns[0]!.replyTarget;
    const ok = await ctx.adapter.postFile!(target, {
      bytes: new Uint8Array([1, 2, 3]),
      filename: 'report\r\n".pdf',
      title: "Your report",
    });
    expect(ok).toEqual({ ok: true, fileId: "sent-1" });
    expect(ctx.api.sent[0]!.attachments).toEqual([
      { filename: "report___.pdf", content: "AQID" },
    ]);
    expect(ctx.api.sent[0]!.text).toBe("Your report");

    const big = await ctx.adapter.postFile!(target, {
      bytes: new Uint8Array(31 * 1024 * 1024),
      filename: "big.bin",
    });
    expect(big.ok).toBe(false);
    expect(ctx.api.sent).toHaveLength(1);
  });

  it("throws on update or delete and does not call the API", async () => {
    const ctx = await setup();
    await expect(ctx.adapter.update({ id: "sent-1" }, ir)).rejects.toThrow(
      /cannot edit/,
    );
    await expect(ctx.adapter.delete({ id: "sent-1" })).rejects.toThrow(
      /cannot delete/,
    );
    expect(ctx.api.sent).toEqual([]);
  });

  it("drops handler buttons without action links, keeping the label", async () => {
    const ctx = await setup();
    await deliver(ctx, receivedEmail("e1"));
    await ctx.adapter.post(ctx.turns[0]!.replyTarget, [
      {
        type: "button",
        props: {
          onClick: { id: "ck:approve" },
          children: [{ type: "text", props: { value: "Approve" } }],
        },
      },
    ]);
    expect(actionLinks(ctx.api.sent[0]!.html)).toEqual([]);
    expect(ctx.api.sent[0]!.text).toBe("Approve");
  });
});

describe("action links", () => {
  const actions = { baseUrl: HOOK_URL, secret: LINK_SECRET };
  const buttonIr: ChannelNode[] = [
    {
      type: "button",
      props: {
        onClick: { id: "ck:approve" },
        value: { approved: true },
        children: [{ type: "text", props: { value: "Approve" } }],
      },
    },
  ];

  async function withLink(options: Partial<ResendAdapterOptions> = {}) {
    const ctx = await setup({ actions, ...options });
    await deliver(ctx, receivedEmail("e1"));
    await ctx.adapter.post(ctx.turns[0]!.replyTarget, buttonIr);
    const [link] = actionLinks(ctx.api.sent[0]!.html);
    return { ...ctx, link: link! };
  }

  it("shows a confirmation page on GET and runs the action on POST", async () => {
    const ctx = await withLink();
    expect(ctx.link.startsWith(`${HOOK_URL}?ck_action=`)).toBe(true);

    const confirm = await ctx.adapter.handler(new Request(ctx.link));
    expect(confirm.status).toBe(200);
    expect(confirm.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await confirm.text()).toContain('<form method="post">');
    await ctx.work.settle();
    expect(ctx.interactions).toEqual([]);

    const done = await ctx.adapter.handler(
      new Request(ctx.link, { method: "POST" }),
    );
    await ctx.work.settle();
    expect(done.status).toBe(200);
    expect(ctx.interactions).toHaveLength(1);
    expect(ctx.interactions[0]).toMatchObject({
      id: "ck:approve",
      value: { approved: true },
      conversationKey: "resend:e1@mail.example.com",
      actor: {
        id: "ann@example.com",
        email: "ann@example.com",
        name: "Ann Lee",
      },
      replyTarget: {
        to: { address: "ann@example.com" },
        subject: "Re: Refund for order 1234",
        inReplyTo: "<e1@mail.example.com>",
      },
    });
  });

  it("refuses a link used twice", async () => {
    const ctx = await withLink();
    await ctx.adapter.handler(new Request(ctx.link, { method: "POST" }));
    const again = await ctx.adapter.handler(
      new Request(ctx.link, { method: "POST" }),
    );
    await ctx.work.settle();
    expect(again.status).toBe(409);
    expect(ctx.interactions).toHaveLength(1);
  });

  it("refuses a tampered link", async () => {
    const ctx = await withLink();
    const url = new URL(ctx.link);
    const [payload, signature] = url.searchParams.get("ck_action")!.split(".");
    const data = JSON.parse(
      Buffer.from(payload!, "base64url").toString("utf8"),
    );
    data.v = { approved: false };
    url.searchParams.set(
      "ck_action",
      `${Buffer.from(JSON.stringify(data)).toString("base64url")}.${signature}`,
    );
    const response = await ctx.adapter.handler(
      new Request(url, { method: "POST" }),
    );
    await ctx.work.settle();
    expect(response.status).toBe(400);
    expect(ctx.interactions).toEqual([]);
  });

  it("refuses an expired link", async () => {
    const ctx = await setup({ actions });
    const token = signActionLink(LINK_SECRET, {
      actionId: "ck:approve",
      conversationKey: "resend:e1@mail.example.com",
      recipient: "ann@example.com",
      expiresAt: Date.now() - 1,
      label: "Approve",
    });
    const response = await ctx.adapter.handler(
      new Request(`${HOOK_URL}?ck_action=${token}`, { method: "POST" }),
    );
    expect(response.status).toBe(410);
    expect(ctx.interactions).toEqual([]);
  });

  it("runs the action on GET when confirmation is off", async () => {
    const ctx = await withLink({ actions: { ...actions, confirm: false } });
    const response = await ctx.adapter.handler(new Request(ctx.link));
    await ctx.work.settle();
    expect(response.status).toBe(200);
    expect(ctx.interactions).toHaveLength(1);
  });

  it("answers 404 for action links when actions are not configured", async () => {
    const ctx = await setup();
    const response = await ctx.adapter.handler(
      new Request(`${HOOK_URL}?ck_action=x.y`),
    );
    expect(response.status).toBe(404);
  });

  it("decodes a link for custom transports", async () => {
    const ctx = await withLink();
    expect(ctx.adapter.decodeInteraction(ctx.link)).toMatchObject({
      id: "ck:approve",
      value: { approved: true },
      conversationKey: "resend:e1@mail.example.com",
    });
    expect(ctx.adapter.decodeInteraction("garbage")).toBeUndefined();
  });
});

describe("options", () => {
  it("validates the sender and the action base URL at construction", () => {
    const base = { apiKey: "re_x", webhookSecret: WEBHOOK_SECRET };
    expect(() => resend({ ...base, from: "not an address" })).toThrow("`from`");
    expect(() =>
      resend({
        ...base,
        from: "a@b.co",
        actions: { baseUrl: "nope", secret: "s" },
      }),
    ).toThrow();
  });
});

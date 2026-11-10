import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FakeAgent,
  MemoryStore,
  createChannel,
} from "@copilotkit/channels-core";
import type { Channel, IngressSink } from "@copilotkit/channels-core";
import type { AgentContentPart } from "@copilotkit/channels-ui";
import { gmail } from "../adapter.js";
import type { GmailAdapterOptions, GmailReplyTarget } from "../types.js";
import { FakeGmail, leaves, partOfType } from "./fake-gmail.js";

const TOKEN = "push-token";
const BASE = "https://bot.test/gmail";

let channel: Channel | undefined;

afterEach(async () => {
  await channel?.stop();
  channel = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function make(extra: Partial<GmailAdapterOptions> = {}) {
  const fake = new FakeGmail();
  const adapter = gmail({
    getAccessToken: () => "access",
    topicName: "projects/p/topics/gmail",
    verificationToken: TOKEN,
    fetch: fake.fetch,
    ...extra,
  });
  return { fake, adapter };
}

const sink = (): IngressSink =>
  ({
    onTurn: vi.fn(),
    onInteraction: vi.fn(),
  }) as unknown as IngressSink;

function push(
  historyId: string,
  token = TOKEN,
  email = "bot@example.com",
): Request {
  return new Request(`${BASE}?token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        data: Buffer.from(
          JSON.stringify({ emailAddress: email, historyId }),
        ).toString("base64"),
        messageId: "1",
      },
    }),
  });
}

const target: GmailReplyTarget = {
  threadId: "t1",
  inboundId: "m1",
  to: "jane@example.org",
  subject: "Hello",
  rfcMessageId: "<m1@x>",
  references: [],
};

describe("gmail() options", () => {
  it("requires credentials, push verification, and a topic", () => {
    const fetch = new FakeGmail().fetch;
    expect(() =>
      gmail({ topicName: "t", verificationToken: "x", fetch }),
    ).toThrow(/oauth/);
    expect(() =>
      gmail({ getAccessToken: () => "a", topicName: "t", fetch }),
    ).toThrow(/pubsubAuth/);
    expect(() =>
      gmail({ getAccessToken: () => "a", verificationToken: "x", fetch }),
    ).toThrow(/topicName/);
    expect(() =>
      gmail({
        getAccessToken: () => "a",
        verificationToken: "x",
        watch: false,
        actions: { baseUrl: BASE, secret: "short" },
        fetch,
      }),
    ).toThrow(/32 characters/);
  });
});

describe("GmailAdapter lifecycle", () => {
  it("watches the mailbox on start and renews the watch daily until stopped", async () => {
    vi.useFakeTimers();
    const { fake, adapter } = make();
    await adapter.start(sink());
    expect(fake.watchCalls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(fake.watchCalls).toHaveLength(2);

    await adapter.stop();
    await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
    expect(fake.watchCalls).toHaveLength(2);
  });

  it("skips users.watch when watch is false, and starts the cursor from the profile", async () => {
    const store = new MemoryStore();
    const { fake, adapter } = make({ watch: false, store });
    fake.historyId = "555";
    await adapter.start(sink());
    expect(fake.watchCalls).toHaveLength(0);
    expect(
      await store.kv.get("channels-gmail:bot@example.com:INBOX:cursor"),
    ).toBe("555");
  });

  it("keeps the stored cursor across restarts", async () => {
    const store = new MemoryStore();
    await store.kv.set("channels-gmail:bot@example.com:INBOX:cursor", "42");
    const { adapter } = make({ store });
    await adapter.start(sink());
    expect(
      await store.kv.get("channels-gmail:bot@example.com:INBOX:cursor"),
    ).toBe("42");
  });
});

describe("GmailAdapter.handler", () => {
  it("answers 503 before start", async () => {
    const { adapter } = make();
    expect((await adapter.handler(push("1"))).status).toBe(503);
  });

  it("answers 401 for a wrong shared token", async () => {
    const { fake, adapter } = make();
    await adapter.start(sink());
    expect((await adapter.handler(push("1", "wrong"))).status).toBe(401);
    expect(fake.calls.some((c) => c.includes("/history"))).toBe(false);
  });

  it("ignores a notification for another mailbox", async () => {
    const { fake, adapter } = make();
    await adapter.start(sink());
    const res = await adapter.handler(push("200", TOKEN, "other@example.com"));
    expect(res.status).toBe(204);
    expect(fake.calls.some((c) => c.includes("/history"))).toBe(false);
  });

  it("answers 500 when Gmail cannot be read, so Pub/Sub retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { fake, adapter } = make();
    await adapter.start(sink());
    fake.historyStatus = 503;
    expect((await adapter.handler(push("200"))).status).toBe(500);
  });

  it("answers 405 for other methods", async () => {
    const { adapter } = make();
    expect((await adapter.handler(new Request(BASE))).status).toBe(405);
  });

  it("hands each email's work to waitUntil", async () => {
    const waitUntil = vi.fn();
    const { fake, adapter } = make({ waitUntil });
    const s = sink();
    await adapter.start(s);
    fake.addMessage({
      id: "m1",
      threadId: "t1",
      from: "jane@example.org",
      text: "hi",
    });
    fake.addMessage({
      id: "m2",
      threadId: "t2",
      from: "joe@example.org",
      text: "yo",
    });
    fake.setHistory(["m1", "m2"], "120");

    await adapter.handler(push("120"));

    expect(waitUntil).toHaveBeenCalledTimes(2);
    await Promise.all(waitUntil.mock.calls.map(([p]) => p));
    expect(vi.mocked(s.onTurn).mock.calls.map(([t]) => t.userText)).toEqual([
      "hi",
      "yo",
    ]);
  });
});

describe("inbound email", () => {
  it("builds a mention turn with the sender and attachments as content parts", async () => {
    const { fake, adapter } = make();
    const s = sink();
    await adapter.start(s);
    fake.addMessage({
      id: "m1",
      threadId: "t1",
      from: "Jane Doe <Jane@Example.org>",
      subject: "Report",
      text: "See attached.",
      attachments: [
        {
          filename: "chart.png",
          mimeType: "image/png",
          bytes: Buffer.from("png!"),
          remote: true,
        },
        {
          filename: "notes.txt",
          mimeType: "text/plain",
          bytes: Buffer.from("line 1"),
        },
        {
          filename: "huge.bin",
          mimeType: "application/octet-stream",
          bytes: Buffer.alloc(10),
        },
      ],
    });
    fake.setHistory(["m1"], "120");

    await adapter.handler(push("120"));

    await vi.waitFor(() => expect(s.onTurn).toHaveBeenCalledTimes(1));
    const turn = vi.mocked(s.onTurn).mock.calls[0]![0];
    expect(turn).toMatchObject({
      conversationKey: "t1",
      userText: "See attached.",
      platform: "gmail",
      eventId: "m1",
      actor: { id: "jane@example.org", kind: "human", name: "Jane Doe" },
      operation: { kind: "created", logicalMessageId: "m1", mentioned: true },
      replyTarget: {
        threadId: "t1",
        to: "jane@example.org",
        subject: "Report",
      },
    });
    expect(turn.contentParts).toEqual<AgentContentPart[]>([
      { type: "text", text: "See attached." },
      {
        type: "image",
        source: {
          type: "data",
          value: Buffer.from("png!").toString("base64"),
          mimeType: "image/png",
        },
      },
      { type: "text", text: "notes.txt:\nline 1" },
      expect.objectContaining({ type: "document" }),
    ]);
  });

  it("skips attachments over the size cap and tells the agent", async () => {
    const { fake, adapter } = make({ files: { maxBytesPerFile: 5 } });
    const s = sink();
    await adapter.start(s);
    fake.addMessage({
      id: "m1",
      threadId: "t1",
      from: "jane@example.org",
      text: "Here",
      attachments: [
        {
          filename: "big.pdf",
          mimeType: "application/pdf",
          bytes: Buffer.alloc(50),
        },
      ],
    });
    fake.setHistory(["m1"], "120");

    await adapter.handler(push("120"));

    await vi.waitFor(() => expect(s.onTurn).toHaveBeenCalledTimes(1));
    expect(vi.mocked(s.onTurn).mock.calls[0]![0].contentParts).toEqual([
      { type: "text", text: "Here\n\n(skipped big.pdf: larger than 5 bytes)" },
    ]);
  });

  it("answers emails in one thread in order", async () => {
    const order: string[] = [];
    const { fake, adapter } = make();
    let release!: () => void;
    const first = new Promise<void>((r) => (release = r));
    await adapter.start({
      onTurn: async (turn: { userText: string }) => {
        order.push(`start ${turn.userText}`);
        if (turn.userText === "one") await first;
        order.push(`end ${turn.userText}`);
      },
    } as unknown as IngressSink);
    fake.addMessage({
      id: "m1",
      threadId: "t1",
      from: "jane@example.org",
      text: "one",
    });
    fake.addMessage({
      id: "m2",
      threadId: "t1",
      from: "jane@example.org",
      text: "two",
    });
    fake.setHistory(["m1", "m2"], "120");

    await adapter.handler(push("120"));
    await vi.waitFor(() => expect(order).toEqual(["start one"]));
    release();

    await vi.waitFor(() =>
      expect(order).toEqual(["start one", "end one", "start two", "end two"]),
    );
  });
});

describe("outbound email", () => {
  it("cannot edit or delete sent mail", async () => {
    const { adapter } = make();
    await expect(adapter.update({ id: "x" }, [])).rejects.toThrow(
      /cannot edit/,
    );
    await expect(adapter.delete({ id: "x" })).rejects.toThrow(/cannot delete/);
  });

  it("sends a file as an attachment, up to the size cap", async () => {
    const { fake, adapter } = make({ maxAttachmentBytes: 10 });
    await adapter.start(sink());

    const ok = await adapter.postFile(target, {
      bytes: Buffer.from("csv,data"),
      filename: "report.csv",
      title: "Your report",
    });
    const tooBig = await adapter.postFile(target, {
      bytes: Buffer.alloc(11),
      filename: "big.bin",
    });

    expect(ok).toMatchObject({ ok: true, messageId: "sent-1" });
    expect(tooBig).toEqual({
      ok: false,
      error: "file is larger than 10 bytes",
    });
    expect(fake.sent).toHaveLength(1);
    const mime = fake.sent[0]!.mime;
    expect(partOfType(mime, "text/plain")!.body.toString()).toBe("Your report");
    const file = leaves(mime).find((p) =>
      p.headers.get("content-type")?.startsWith("text/csv"),
    );
    expect(file?.body.toString()).toBe("csv,data");
  });

  it("collects streamed chunks into one email", async () => {
    const { fake, adapter } = make();
    await adapter.start(sink());
    await adapter.stream(
      target,
      (async function* () {
        yield "Hello ";
        yield "there";
      })(),
    );
    expect(fake.sent).toHaveLength(1);
    expect(partOfType(fake.sent[0]!.mime, "text/plain")!.body.toString()).toBe(
      "Hello there",
    );
  });

  it("sends the turn's agent text as one email, even across several messages", async () => {
    const { fake, adapter } = make();
    await adapter.start(sink());
    const renderer = adapter.createRunRenderer(target);
    const s = renderer.subscriber as Required<typeof renderer.subscriber>;
    const ev = (event: object) => ({ event }) as never;
    await s.onTextMessageStartEvent(ev({ messageId: "a" }));
    await s.onTextMessageContentEvent(ev({ messageId: "a", delta: "First." }));
    await s.onTextMessageStartEvent(ev({ messageId: "b" }));
    await s.onTextMessageContentEvent(ev({ messageId: "b", delta: "Second." }));
    expect(fake.sent).toHaveLength(0);

    await renderer.finish!();
    await renderer.finish!();

    expect(fake.sent).toHaveLength(1);
    expect(partOfType(fake.sent[0]!.mime, "text/plain")!.body.toString()).toBe(
      "First.\n\nSecond.",
    );
  });

  it("refuses awaitChoice when action links are off", async () => {
    const { fake, adapter } = make();
    const errors: unknown[] = [];
    channel = createChannel({
      identifyUser: "platform",
      adapters: [adapter],
      agent: () => new FakeAgent(),
    });
    channel.onMention(async ({ thread }) => {
      try {
        await thread.awaitChoice("Pick one");
      } catch (err) {
        errors.push(err);
      }
    });
    await channel.start();
    fake.addMessage({
      id: "m1",
      threadId: "t1",
      from: "jane@example.org",
      text: "hi",
    });
    fake.setHistory(["m1"], "120");

    await adapter.handler(push("120"));

    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(fake.sent).toHaveLength(0);
    expect(
      make({ actions: { baseUrl: BASE, secret: "s".repeat(32) } }).adapter
        .capabilities.supportsBlockingChoice,
    ).toBe(true);
  });

  it("drops handler buttons without action links and keeps their label", async () => {
    const { fake, adapter } = make();
    await adapter.start(sink());
    await adapter.post(target, [
      {
        type: "button",
        props: {
          onClick: { id: "ck:1" },
          children: [{ type: "text", props: { value: "Approve" } }],
        },
      },
    ]);
    const text = partOfType(fake.sent[0]!.mime, "text/plain")!.body.toString();
    expect(text).toBe("[Approve]");
  });
});

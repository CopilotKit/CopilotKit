import { describe, it, expect, vi } from "vitest";
import { telegram } from "../adapter.js";
import { FakeTelegramConnector } from "../testing/fake-telegram-connector.js";

/** A credential-free adapter with a `FakeTelegramConnector` bound via `ɵbindConnector`. */
function setup() {
  const a = telegram({});
  const connector = new FakeTelegramConnector();
  a.ɵbindConnector(connector);
  return { a, connector };
}

describe("TelegramAdapter", () => {
  it("advertises Telegram capabilities", () => {
    const { a } = setup();
    expect(a.platform).toBe("telegram");
    expect(a.capabilities).toMatchObject({
      supportsTyping: true,
      supportsStreaming: true,
      supportsModals: false,
    });
    expect(a.ackDeadlineMs).toBe(3000);
  });

  it("advertises the full capability shape", () => {
    const { a } = setup();
    expect(a.capabilities).toEqual({
      supportsModals: false,
      supportsTyping: true,
      supportsReactions: true,
      supportsEphemeral: false,
      supportsStreaming: true,
      supportsSuggestedPrompts: false,
      supportsThreadTitle: true,
    });
  });

  it("post() throws before a connector is bound (credential-free signpost)", async () => {
    const a = telegram({});
    await expect(
      a.post(
        { chatId: 9 } as any,
        [
          {
            type: "section",
            props: { children: { type: "text", props: { value: "hi" } } },
          },
        ] as any,
      ),
    ).rejects.toThrow(/requires a custom ChannelRunner/);
  });

  it("posts a rendered message and returns a composite ref", async () => {
    const { a, connector } = setup();
    const ref: any = await a.post(
      { chatId: 9 } as any,
      [
        {
          type: "section",
          props: { children: { type: "text", props: { value: "hi" } } },
        },
      ] as any,
    );
    expect(ref).toMatchObject({ chatId: 9 });
    expect(connector.calls[0]!.op).toBe("sendMessage");
  });

  it("registerCommands publishes to setMyCommands", async () => {
    const { a, connector } = setup();
    await a.registerCommands!([
      { name: "triage", description: "Triage" },
    ] as any);
    expect(connector.calls[0]!.op).toBe("setMyCommands");
    expect(connector.calls[0]!.args).toEqual([
      { command: "triage", description: "Triage" },
    ]);
  });

  it("registerCommands converts hyphens to underscores so the command registers", async () => {
    const { a, connector } = setup();
    await a.registerCommands!([
      { name: "agent" },
      { name: "triage" },
      { name: "preview" },
      { name: "file-issue" },
    ] as any);
    expect(connector.calls).toHaveLength(1);
    // `file-issue` is converted to `file_issue` (Telegram forbids hyphens);
    // engine routing still matches because normalizeCommandName collapses both.
    expect(connector.calls[0]!.args).toEqual([
      { command: "agent", description: "agent" },
      { command: "triage", description: "triage" },
      { command: "preview", description: "preview" },
      { command: "file_issue", description: "file-issue" },
    ]);
  });

  it("registerCommands skips names still invalid after conversion, and skips the call when none are valid", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { a, connector } = setup();
      await a.registerCommands!([
        { name: "bad name" }, // space — invalid even after hyphen conversion
        { name: "no!" }, // punctuation — invalid
      ] as any);
      expect(connector.calls).toHaveLength(0);
      expect(
        warnSpy.mock.calls.some((c) => String(c[0]).includes("bad name")),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("delete delegates to connector.deleteMessage", async () => {
    const { a, connector } = setup();
    await a.delete({ id: "9:11", chatId: 9, messageId: 11 } as any);
    expect(connector.calls[0]).toEqual({
      op: "deleteMessage",
      args: { chatId: 9, messageId: 11 },
    });
  });

  it("delete is a no-op for a bogus (empty) ref", async () => {
    const { a, connector } = setup();
    await a.delete({ id: "", chatId: 9, messageId: 0 } as any);
    expect(connector.calls).toHaveLength(0);
  });

  it("setThreadTitle without a forum topic returns { ok: false }", async () => {
    const { a, connector } = setup();
    const res = await a.setThreadTitle!({ chatId: 9 } as any, "Title");
    expect(res.ok).toBe(false);
    expect(connector.calls).toHaveLength(0);
  });

  it("setThreadTitle with a forum topic edits the topic", async () => {
    const { a, connector } = setup();
    const res = await a.setThreadTitle!(
      { chatId: 9, messageThreadId: 42 } as any,
      "Title",
    );
    expect(res.ok).toBe(true);
    expect(connector.calls[0]).toEqual({
      op: "editForumTopic",
      args: { chatId: 9, messageThreadId: 42, name: "Title" },
    });
  });

  it("setSuggestedPrompts is unsupported", async () => {
    const { a } = setup();
    const res = await a.setSuggestedPrompts!({ chatId: 9 } as any, []);
    expect(res).toEqual({ ok: false, error: "unsupported" });
  });

  it("update() is a no-op when the ref has messageId 0 (empty stream ref)", async () => {
    const { a, connector } = setup();
    await a.update(
      { id: "", chatId: 9, messageId: 0 } as any,
      [
        {
          type: "section",
          props: { children: { type: "text", props: { value: "hi" } } },
        },
      ] as any,
    );
    expect(connector.calls).toHaveLength(0);
  });

  it('update() swallows a "message is not modified" error', async () => {
    const { a, connector } = setup();
    connector.results.throwing = {
      editMessageText: new Error("Bad Request: message is not modified"),
    };
    await expect(
      a.update(
        { id: "9:11", chatId: 9, messageId: 11 } as any,
        [
          {
            type: "section",
            props: { children: { type: "text", props: { value: "hi" } } },
          },
        ] as any,
      ),
    ).resolves.toBeUndefined();
    expect(connector.calls[0]!.op).toBe("editMessageText");
  });

  it("post() records the plain-text (stripped) form into history", async () => {
    const { a } = setup();
    const target: any = { chatId: 9, conversationKey: "tg:9:dm" };
    await a.post(target, [
      {
        type: "section",
        props: { children: { type: "text", props: { value: "a & b" } } },
      },
    ] as any);
    const messages = await a.getMessages(target);
    expect(messages.length).toBe(1);
    // The HTML-escaped "&amp;" must be decoded back to "&" in stored history,
    // and no markup tags should remain.
    expect(messages[0]!.text).not.toContain("&amp;");
    expect(messages[0]!.text).not.toMatch(/<[^>]+>/);
    expect(messages[0]!.text).toContain("a & b");
    expect(messages[0]!.isBot).toBe(true);
  });

  it("post() with an image-only payload (no text) sends a photo, not a message", async () => {
    const { a, connector } = setup();
    const ref: any = await a.post(
      { chatId: 9 } as any,
      [
        {
          type: "image",
          props: { url: "https://example.com/cat.png", alt: "cat" },
        },
      ] as any,
    );
    // The empty sendMessage must be skipped (Telegram rejects empty text).
    expect(connector.calls.map((c) => c.op)).toEqual(["sendPhoto"]);
    expect(ref).toMatchObject({ chatId: 9 });
  });

  it("createRunRenderer streaming degrades to plain text on a parse error", async () => {
    const { a, connector } = setup();
    let rejectedOnce = false;
    const original = connector.editMessageText.bind(connector);
    connector.editMessageText = (async (args: any) => {
      if (!rejectedOnce) {
        rejectedOnce = true;
        throw new Error("Bad Request: can't parse entities: bad tag");
      }
      return original(args);
    }) as typeof connector.editMessageText;
    const renderer = a.createRunRenderer!({ chatId: 9 } as any);
    // Drive the renderer through a streamed text message, then finalize. A
    // mid-stream edit rejects with a parse error; the fallback must retry as
    // plain text so the terminal flush does not throw.
    const sub: any = renderer.subscriber;
    await sub.onTextMessageStartEvent({ event: { messageId: "m1" } });
    await sub.onTextMessageContentEvent({
      event: { messageId: "m1", delta: "hello <b>world" },
    });
    await sub.onTextMessageEndEvent({ event: { messageId: "m1" } });
    await expect(sub.onRunFinishedEvent({ event: {} })).resolves.not.toThrow();
    expect(connector.calls.some((c) => c.op === "editMessageText")).toBe(true);
  });

  it("update() is a no-op when the IR renders to empty text (image-only IR)", async () => {
    const { a, connector } = setup();
    // An image-only IR produces empty p.text — update() must not call editMessageText.
    await a.update(
      { id: "9:12", chatId: 9, messageId: 12 } as any,
      [
        {
          type: "image",
          props: { url: "https://example.com/cat.png", alt: "cat" },
        },
      ] as any,
    );
    expect(connector.calls).toHaveLength(0);
  });

  it("post() with an image-only payload does NOT record a blank entry into history", async () => {
    const { a } = setup();
    const target: any = { chatId: 9, conversationKey: "tg:9:dm" };
    await a.post(target, [
      {
        type: "image",
        props: { url: "https://example.com/cat.png", alt: "cat" },
      },
    ] as any);
    const messages = await a.getMessages(target);
    // No blank bot turn should be recorded for an image-only post.
    const blankBotTurns = messages.filter((m) => m.isBot && !m.text.trim());
    expect(blankBotTurns).toHaveLength(0);
  });

  it("group-chat post → getMessages round-trip uses the stamped conversationKey", async () => {
    const { a } = setup();
    // Simulate a group-chat ReplyTarget with a user: conversationKey stamped at ingress.
    const target: any = { chatId: 9, conversationKey: "tg:9:user:5" };
    await a.post(target, [
      {
        type: "section",
        props: { children: { type: "text", props: { value: "hello group" } } },
      },
    ] as any);
    const messages = await a.getMessages(target);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toMatchObject({
      isBot: true,
      text: expect.any(String),
    });
  });
});

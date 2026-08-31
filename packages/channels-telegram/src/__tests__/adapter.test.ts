import { describe, it, expect, vi } from "vitest";
import { telegram } from "../adapter.js";

function fakeApi() {
  return {
    sendMessage: vi.fn(async () => ({ message_id: 11, chat: { id: 9 } })),
    editMessageText: vi.fn(async () => true),
    deleteMessage: vi.fn(async () => true),
    setMyCommands: vi.fn(async () => true),
    sendPhoto: vi.fn(async () => ({ message_id: 12, chat: { id: 9 } })),
    sendChatAction: vi.fn(async () => true),
    editForumTopic: vi.fn(async () => true),
  };
}

describe("TelegramAdapter", () => {
  it("advertises Telegram capabilities", () => {
    const a = telegram({ token: "t" });
    expect(a.platform).toBe("telegram");
    expect(a.capabilities).toMatchObject({
      supportsTyping: true,
      supportsStreaming: true,
      supportsModals: false,
    });
    expect(a.ackDeadlineMs).toBe(3000);
  });

  it("advertises the full capability shape", () => {
    const a = telegram({ token: "t" });
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

  it("posts a rendered message and returns a composite ref", async () => {
    const a = telegram({ token: "t" });
    (a as any).bot = { api: fakeApi() };
    const ref: any = await a.post(
      { chatId: 9 } as any,
      [
        {
          type: "section",
          props: { children: { type: "text", props: { value: "hi" } } },
        },
      ] as any,
    );
    expect(ref).toMatchObject({ chatId: 9, messageId: 11 });
    expect((a as any).bot.api.sendMessage).toHaveBeenCalled();
  });

  it("registerCommands publishes to setMyCommands", async () => {
    const a = telegram({ token: "t" });
    (a as any).bot = { api: fakeApi() };
    await a.registerCommands!([
      { name: "triage", description: "Triage" },
    ] as any);
    expect((a as any).bot.api.setMyCommands).toHaveBeenCalledWith([
      { command: "triage", description: "Triage" },
    ]);
  });

  it("registerCommands converts hyphens to underscores so the command registers", async () => {
    const a = telegram({ token: "t" });
    (a as any).bot = { api: fakeApi() };
    await a.registerCommands!([
      { name: "agent" },
      { name: "triage" },
      { name: "preview" },
      { name: "file-issue" },
    ] as any);
    expect((a as any).bot.api.setMyCommands).toHaveBeenCalledTimes(1);
    // `file-issue` is converted to `file_issue` (Telegram forbids hyphens);
    // engine routing still matches because normalizeCommandName collapses both.
    expect((a as any).bot.api.setMyCommands).toHaveBeenCalledWith([
      { command: "agent", description: "agent" },
      { command: "triage", description: "triage" },
      { command: "preview", description: "preview" },
      { command: "file_issue", description: "file-issue" },
    ]);
  });

  it("registerCommands skips names still invalid after conversion, and skips the call when none are valid", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const a = telegram({ token: "t" });
      (a as any).bot = { api: fakeApi() };
      await a.registerCommands!([
        { name: "bad name" }, // space — invalid even after hyphen conversion
        { name: "no!" }, // punctuation — invalid
      ] as any);
      expect((a as any).bot.api.setMyCommands).not.toHaveBeenCalled();
      expect(
        warnSpy.mock.calls.some((c) => String(c[0]).includes("bad name")),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("delete delegates to deleteMessage", async () => {
    const a = telegram({ token: "t" });
    (a as any).bot = { api: fakeApi() };
    await a.delete({ id: "9:11", chatId: 9, messageId: 11 } as any);
    expect((a as any).bot.api.deleteMessage).toHaveBeenCalledWith(9, 11);
  });

  it("setThreadTitle without a forum topic returns { ok: false }", async () => {
    const a = telegram({ token: "t" });
    (a as any).bot = { api: fakeApi() };
    const res = await a.setThreadTitle!({ chatId: 9 } as any, "Title");
    expect(res.ok).toBe(false);
    expect((a as any).bot.api.editForumTopic).not.toHaveBeenCalled();
  });

  it("setThreadTitle with a forum topic edits the topic", async () => {
    const a = telegram({ token: "t" });
    (a as any).bot = { api: fakeApi() };
    const res = await a.setThreadTitle!(
      { chatId: 9, messageThreadId: 42 } as any,
      "Title",
    );
    expect(res.ok).toBe(true);
    expect((a as any).bot.api.editForumTopic).toHaveBeenCalledWith(9, 42, {
      name: "Title",
    });
  });

  it("setSuggestedPrompts is unsupported", async () => {
    const a = telegram({ token: "t" });
    const res = await a.setSuggestedPrompts!({ chatId: 9 } as any, []);
    expect(res).toEqual({ ok: false, error: "unsupported" });
  });

  it("update() is a no-op when the ref has messageId 0 (empty stream ref)", async () => {
    const a = telegram({ token: "t" });
    (a as any).bot = { api: fakeApi() };
    await a.update(
      { id: "", chatId: 9, messageId: 0 } as any,
      [
        {
          type: "section",
          props: { children: { type: "text", props: { value: "hi" } } },
        },
      ] as any,
    );
    expect((a as any).bot.api.editMessageText).not.toHaveBeenCalled();
  });

  it('update() swallows a "message is not modified" error', async () => {
    const a = telegram({ token: "t" });
    const api = fakeApi();
    api.editMessageText = vi.fn(async () => {
      throw new Error("Bad Request: message is not modified");
    });
    (a as any).bot = { api };
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
    expect(api.editMessageText).toHaveBeenCalled();
  });

  it("post() records the plain-text (stripped) form into history", async () => {
    const a = telegram({ token: "t" });
    (a as any).bot = { api: fakeApi() };
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
    const a = telegram({ token: "t" });
    (a as any).bot = { api: fakeApi() };
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
    expect((a as any).bot.api.sendMessage).not.toHaveBeenCalled();
    expect((a as any).bot.api.sendPhoto).toHaveBeenCalled();
    // The returned ref must reference the actually-posted photo message.
    expect(ref).toMatchObject({ chatId: 9, messageId: 12 });
  });

  it("createRunRenderer streaming degrades to plain text on a parse error", async () => {
    const a = telegram({ token: "t" });
    const api = fakeApi();
    let rejectedOnce = false;
    api.editMessageText = vi.fn(async () => {
      if (!rejectedOnce) {
        rejectedOnce = true;
        throw new Error("Bad Request: can't parse entities: bad tag");
      }
      return true;
    });
    (a as any).bot = { api };
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
    expect(api.editMessageText).toHaveBeenCalled();
  });

  it("update() is a no-op when the IR renders to empty text (image-only IR)", async () => {
    const a = telegram({ token: "t" });
    (a as any).bot = { api: fakeApi() };
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
    expect((a as any).bot.api.editMessageText).not.toHaveBeenCalled();
  });

  it("post() with an image-only payload does NOT record a blank entry into history", async () => {
    const a = telegram({ token: "t" });
    (a as any).bot = { api: fakeApi() };
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

  it('"auto" mode in a serverless env WITHOUT a webhook domain falls back to polling', async () => {
    // Simulate a serverless deploy with no configured webhook.domain. "auto"
    // must fall back to long-polling rather than choosing webhook (which would
    // throw in startWebhook). We assert via start(): it should kick off polling
    // (bot.start) and never register a webhook (setWebhook).
    vi.stubEnv("VERCEL", "1");
    try {
      const a = telegram({ token: "t", mode: "auto" });
      const api = {
        ...fakeApi(),
        getMe: vi.fn(async () => ({ id: 1, username: "bot" })),
        setWebhook: vi.fn(async () => true),
      };
      const start = vi.fn(async () => {});
      // attachTelegramListener registers handlers via on()/command(); start()
      // also installs an error boundary via bot.catch(). Stub them all.
      (a as any).bot = {
        api,
        start,
        on: vi.fn(),
        command: vi.fn(),
        catch: vi.fn(),
      };
      await a.start({ submit: vi.fn() } as any);
      expect(start).toHaveBeenCalled();
      expect(api.setWebhook).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("stop() deletes the webhook BEFORE closing the server, then stops the bot", async () => {
    const a = telegram({ token: "t" });
    const callOrder: string[] = [];
    const close = vi.fn((cb: () => void) => {
      callOrder.push("close");
      cb();
    });
    const deleteWebhook = vi.fn(async () => {
      callOrder.push("deleteWebhook");
      return true;
    });
    const botStop = vi.fn(async () => {
      callOrder.push("botStop");
    });
    (a as any).webhookServer = { close };
    (a as any).bot = { api: { deleteWebhook }, stop: botStop };
    await a.stop();
    expect(deleteWebhook).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(botStop).toHaveBeenCalled();
    // The server reference must be cleared so a restart rebinds cleanly.
    expect((a as any).webhookServer).toBeUndefined();
    // deleteWebhook must precede server.close so Telegram stops POSTing before
    // the local socket is torn down (avoids refused-connection errors on
    // in-flight webhook deliveries during shutdown).
    expect(callOrder).toEqual(["deleteWebhook", "close", "botStop"]);
  });

  it("group-chat post → getMessages round-trip uses the stamped conversationKey", async () => {
    const a = telegram({ token: "t" });
    (a as any).bot = { api: fakeApi() };
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

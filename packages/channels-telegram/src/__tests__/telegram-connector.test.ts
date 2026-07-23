import { describe, it, expect, vi, beforeEach } from "vitest";
import { GrammyTelegramConnector } from "../telegram-connector.js";
import { TelegramConversationStore } from "../conversation-store.js";

/**
 * `GrammyTelegramConnector.downloadFile` owns the credentialed
 * getFile→fetch pipeline that used to live inline in `download-files.ts`
 * (token-URL construction, Content-Length pre-check, token redaction). These
 * tests exercise it directly, stubbing the underlying grammY `bot.api` and
 * global `fetch` (construction is side-effect-free, so this is safe without a
 * real bot token).
 */
function stubGetFile(
  connector: GrammyTelegramConnector,
  filePath: string,
): void {
  (
    connector as unknown as { bot: { api: { getFile: unknown } } }
  ).bot.api.getFile = vi.fn(async () => ({ file_path: filePath }));
}

function connectorWithFakeGetFile(filePath = "photos/f1.png") {
  const connector = new GrammyTelegramConnector({ token: "SECRETTOKEN" });
  stubGetFile(connector, filePath);
  return connector;
}

describe("GrammyTelegramConnector.downloadFile", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads and returns bytes on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => new TextEncoder().encode("PNGDATA").buffer,
      })) as unknown as typeof fetch,
    );
    const connector = connectorWithFakeGetFile();
    const result = await connector.downloadFile("f1");
    expect(result.ok).toBe(true);
    expect(result.bytes?.toString()).toBe("PNGDATA");
  });

  it("returns ok:false with the HTTP status on a failed fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
      })) as unknown as typeof fetch,
    );
    const connector = connectorWithFakeGetFile();
    const result = await connector.downloadFile("f1");
    expect(result).toEqual({ ok: false, status: 404 });
  });

  it("redacts the bot token from a fetch error message", async () => {
    const SECRET_TOKEN = "1234567890:AABBCCDDEEFF";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(
          `fetch failed: connect ECONNREFUSED https://api.telegram.org/file/bot${SECRET_TOKEN}/photos/f1.png`,
        );
      }) as unknown as typeof fetch,
    );
    const connector = new GrammyTelegramConnector({ token: SECRET_TOKEN });
    stubGetFile(connector, "photos/f1.png");
    const result = await connector.downloadFile("f1");
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain(SECRET_TOKEN);
    expect(result.error).toContain("<redacted>");
  });

  it("skips via Content-Length before buffering when it exceeds maxBytesHint", async () => {
    const arrayBuffer = vi.fn(
      async () => new TextEncoder().encode("PNGDATA").buffer,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name === "content-length" ? "99000000" : null,
        },
        arrayBuffer,
      })) as unknown as typeof fetch,
    );
    const connector = connectorWithFakeGetFile();
    const result = await connector.downloadFile("bigphoto", {
      maxBytesHint: 10,
    });
    expect(result.ok).toBe(false);
    // The body must NOT have been read — the pre-check should have aborted.
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("returns ok:false when getFile itself fails, redacting the token", async () => {
    const SECRET_TOKEN = "9999:XYZ";
    const connector = new GrammyTelegramConnector({ token: SECRET_TOKEN });
    (
      connector as unknown as { bot: { api: { getFile: unknown } } }
    ).bot.api.getFile = vi.fn(async () => {
      throw new Error(`getFile failed for token ${SECRET_TOKEN}`);
    });
    const result = await connector.downloadFile("f1");
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain(SECRET_TOKEN);
  });
});

describe("GrammyTelegramConnector ingress ownership", () => {
  it('"auto" mode in a serverless env WITHOUT a webhook domain falls back to polling', async () => {
    // Simulate a serverless deploy with no configured webhook.domain. "auto"
    // must fall back to long-polling rather than choosing webhook (which
    // would throw in startWebhook). Assert via startIngress(): it should
    // kick off polling (bot.start) and never register a webhook (setWebhook).
    vi.stubEnv("VERCEL", "1");
    try {
      const connector = new GrammyTelegramConnector({
        token: "t",
        mode: "auto",
      });
      const api = {
        getMe: vi.fn(async () => ({ id: 1, username: "bot" })),
        setWebhook: vi.fn(async () => true),
      };
      const start = vi.fn(async () => {});
      // attachTelegramListener registers handlers via on()/command(); startIngress
      // also installs an error boundary via bot.catch(). Stub them all.
      (connector as unknown as { bot: unknown }).bot = {
        api,
        start,
        on: vi.fn(),
        command: vi.fn(),
        catch: vi.fn(),
      };
      const sink = {
        onTurn: vi.fn(),
        onInteraction: vi.fn(),
        onCommand: vi.fn(),
        onThreadStarted: vi.fn(),
        onReaction: vi.fn(),
        onModalSubmit: vi.fn(),
        onModalClose: vi.fn(),
      };
      await connector.startIngress({
        sink,
        store: new TelegramConversationStore(),
      });
      expect(start).toHaveBeenCalled();
      expect(api.setWebhook).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("stopIngress() deletes the webhook BEFORE closing the server, then stops the bot", async () => {
    const connector = new GrammyTelegramConnector({ token: "t" });
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
    (connector as unknown as { webhookServer: unknown }).webhookServer = {
      close,
    };
    (connector as unknown as { bot: unknown }).bot = {
      api: { deleteWebhook },
      stop: botStop,
    };
    await connector.stopIngress();
    expect(deleteWebhook).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(botStop).toHaveBeenCalled();
    // The server reference must be cleared so a restart rebinds cleanly.
    expect(
      (connector as unknown as { webhookServer: unknown }).webhookServer,
    ).toBeUndefined();
    // deleteWebhook must precede server.close so Telegram stops POSTing before
    // the local socket is torn down (avoids refused-connection errors on
    // in-flight webhook deliveries during shutdown).
    expect(callOrder).toEqual(["deleteWebhook", "close", "botStop"]);
  });
});

import type {
  TelegramConnector,
  TelegramConnectorChat,
  TelegramDownloadResult,
  TelegramIngressConfig,
  TelegramIngressConnection,
  TelegramReplyMarkup,
  TelegramSentMessage,
} from "../telegram-connector.js";
import type { IngressSink, IncomingTurn } from "@copilotkit/channels-core";

/** One recorded call to a {@link FakeTelegramConnector} op, in call order. */
export type TelegramConnectorCall =
  | {
      op: "sendMessage";
      args: {
        chatId: number | string;
        text: string;
        parseMode?: "HTML";
        messageThreadId?: number;
        replyMarkup?: TelegramReplyMarkup;
        replyToMessageId?: number;
      };
    }
  | {
      op: "sendPhoto";
      args: {
        chatId: number | string;
        url: string;
        caption?: string;
        messageThreadId?: number;
        replyMarkup?: TelegramReplyMarkup;
        replyToMessageId?: number;
      };
    }
  | {
      op: "editMessageText";
      args: {
        chatId: number | string;
        messageId: number;
        text: string;
        parseMode?: "HTML";
        replyMarkup?: TelegramReplyMarkup;
      };
    }
  | {
      op: "deleteMessage";
      args: { chatId: number | string; messageId: number };
    }
  | {
      op: "sendChatAction";
      args: {
        chatId: number | string;
        action: "typing";
        messageThreadId?: number;
      };
    }
  | {
      op: "sendDocument";
      args: {
        chatId: number | string;
        bytes: Buffer;
        filename: string;
        messageThreadId?: number;
      };
    }
  | { op: "getChat"; args: { query: string } }
  | {
      op: "setMyCommands";
      args: { command: string; description: string }[];
    }
  | {
      op: "editForumTopic";
      args: { chatId: number | string; messageThreadId: number; name: string };
    }
  | {
      op: "setMessageReaction";
      args: {
        chatId: number | string;
        messageId: number;
        reactions: { type: "emoji"; emoji: string }[];
      };
    }
  | { op: "downloadFile"; args: { fileId: string; maxBytesHint?: number } };

/**
 * Per-op canned responses / failures a test can set on a
 * {@link FakeTelegramConnector} before exercising it. Anything left unset
 * falls back to a harmless default (an incrementing fake messageId, etc.).
 */
export interface FakeTelegramConnectorResults {
  sendMessage?: TelegramSentMessage;
  sendPhoto?: TelegramSentMessage;
  sendDocument?: { fileId?: string };
  getChat?: TelegramConnectorChat | undefined;
  downloadFile?: TelegramDownloadResult;
  /** Ops (by name) that should reject instead of resolving, with the given error. */
  throwing?: Partial<Record<TelegramConnectorCall["op"], Error>>;
}

/**
 * Records every call made to it (op + exact args, in order) and resolves with
 * configurable canned responses — the TDD fixture proving `TelegramAdapter`'s
 * egress methods route to the right {@link TelegramConnector} op with the
 * right args, without a real (or grammY-shaped fake) Telegram Bot API
 * underneath.
 */
export class FakeTelegramConnector implements TelegramConnector {
  readonly calls: TelegramConnectorCall[] = [];
  private seq = 0;
  /** Set by {@link startIngress}; readable so a test can assert on the config it was handed. */
  ingressConfig: TelegramIngressConfig | undefined;
  /** True once {@link stopIngress} has been called. */
  ingressStopped = false;
  /**
   * Captured from {@link TelegramIngressConfig.sink} by {@link startIngress}
   * — the SAME `IngressSink` a real grammY-backed connector would forward
   * normalized turns to. Lets {@link emitTurn} push a fake inbound turn
   * straight into the real channels-core dispatch (`sink.onTurn` → legacy or
   * §2 dispatch → `thread.runAgent` → egress) without a real grammY poller —
   * the Model-1 standalone proof.
   */
  private sink: IngressSink | undefined;

  constructor(readonly results: FakeTelegramConnectorResults = {}) {}

  private throwIfConfigured(op: TelegramConnectorCall["op"]): void {
    const err = this.results.throwing?.[op];
    if (err) throw err;
  }

  async sendMessage(args: {
    chatId: number | string;
    text: string;
    parseMode?: "HTML";
    messageThreadId?: number;
    replyMarkup?: TelegramReplyMarkup;
    replyToMessageId?: number;
  }): Promise<TelegramSentMessage> {
    this.calls.push({ op: "sendMessage", args });
    this.throwIfConfigured("sendMessage");
    return (
      this.results.sendMessage ?? {
        chatId: args.chatId,
        messageId: ++this.seq,
      }
    );
  }

  async sendPhoto(args: {
    chatId: number | string;
    url: string;
    caption?: string;
    messageThreadId?: number;
    replyMarkup?: TelegramReplyMarkup;
    replyToMessageId?: number;
  }): Promise<TelegramSentMessage> {
    this.calls.push({ op: "sendPhoto", args });
    this.throwIfConfigured("sendPhoto");
    return (
      this.results.sendPhoto ?? {
        chatId: args.chatId,
        messageId: ++this.seq,
      }
    );
  }

  async editMessageText(args: {
    chatId: number | string;
    messageId: number;
    text: string;
    parseMode?: "HTML";
    replyMarkup?: TelegramReplyMarkup;
  }): Promise<void> {
    this.calls.push({ op: "editMessageText", args });
    this.throwIfConfigured("editMessageText");
  }

  async deleteMessage(args: {
    chatId: number | string;
    messageId: number;
  }): Promise<void> {
    this.calls.push({ op: "deleteMessage", args });
    this.throwIfConfigured("deleteMessage");
  }

  async sendChatAction(args: {
    chatId: number | string;
    action: "typing";
    messageThreadId?: number;
  }): Promise<void> {
    this.calls.push({ op: "sendChatAction", args });
    this.throwIfConfigured("sendChatAction");
  }

  async sendDocument(args: {
    chatId: number | string;
    bytes: Buffer;
    filename: string;
    messageThreadId?: number;
  }): Promise<{ fileId?: string }> {
    this.calls.push({ op: "sendDocument", args });
    this.throwIfConfigured("sendDocument");
    return this.results.sendDocument ?? { fileId: `fake-file-${++this.seq}` };
  }

  async getChat(query: string): Promise<TelegramConnectorChat | undefined> {
    this.calls.push({ op: "getChat", args: { query } });
    this.throwIfConfigured("getChat");
    return this.results.getChat;
  }

  async setMyCommands(
    commands: { command: string; description: string }[],
  ): Promise<void> {
    this.calls.push({ op: "setMyCommands", args: commands });
    this.throwIfConfigured("setMyCommands");
  }

  async editForumTopic(args: {
    chatId: number | string;
    messageThreadId: number;
    name: string;
  }): Promise<void> {
    this.calls.push({ op: "editForumTopic", args });
    this.throwIfConfigured("editForumTopic");
  }

  async setMessageReaction(args: {
    chatId: number | string;
    messageId: number;
    reactions: { type: "emoji"; emoji: string }[];
  }): Promise<void> {
    this.calls.push({ op: "setMessageReaction", args });
    this.throwIfConfigured("setMessageReaction");
  }

  async downloadFile(
    fileId: string,
    opts?: { maxBytesHint?: number },
  ): Promise<TelegramDownloadResult> {
    this.calls.push({
      op: "downloadFile",
      args: { fileId, maxBytesHint: opts?.maxBytesHint },
    });
    this.throwIfConfigured("downloadFile");
    return this.results.downloadFile ?? { ok: true, bytes: Buffer.alloc(0) };
  }

  /**
   * No real grammY poller here — records the config it was handed (so a test
   * can assert on `store`) and captures `config.sink` (see {@link emitTurn})
   * so a test can drive fake inbound turns through it. Resolves with a
   * canned connection. Raw Telegram-shaped ingress (message/callback_query
   * payloads) is still exercised against `attachTelegramListener` directly —
   * this fake only proves what happens AFTER a turn reaches the sink.
   */
  async startIngress(
    config: TelegramIngressConfig,
  ): Promise<TelegramIngressConnection> {
    this.ingressConfig = config;
    this.sink = config.sink;
    return { botUserId: 999, botUsername: "fake_bot" };
  }

  async stopIngress(): Promise<void> {
    this.ingressStopped = true;
  }

  /**
   * Push a fake inbound turn through the `sink` captured by
   * {@link startIngress} — the Model-1 standalone proof's ingress entry
   * point. Mirrors channels-core's `FakeAdapter.emitTurn`, but RETURNS the
   * underlying `sink.onTurn` promise (rather than firing-and-forgetting) so a
   * test can `await` a turn all the way through dispatch → `thread.runAgent`
   * → egress before asserting, instead of racing a `setTimeout(0)` tick.
   *
   * Throws if ingress hasn't started yet (`channel.start()`/
   * `TelegramAdapter.start()` not called) — this proves the standalone
   * dispatch wiring, so a call before `start()` is a test bug, not a
   * tolerable no-op.
   */
  emitTurn(
    turn: Partial<IncomingTurn> & { conversationKey: string },
  ): Promise<void> {
    if (!this.sink) {
      throw new Error(
        "FakeTelegramConnector.emitTurn: ingress not started — call " +
          "channel.start() (which calls TelegramAdapter.start()) first",
      );
    }
    return Promise.resolve(
      this.sink.onTurn({
        replyTarget: { chatId: 1 },
        userText: "",
        platform: "telegram",
        ...turn,
      }),
    );
  }
}

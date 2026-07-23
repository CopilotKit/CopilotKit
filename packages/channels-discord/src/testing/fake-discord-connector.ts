import type {
  CommandSpec,
  IngressSink,
  IncomingTurn,
} from "@copilotkit/channels-core";
import type {
  DiscordConnector,
  DiscordConnectorMessage,
  DiscordIngressConfig,
  DiscordIngressConnection,
  DiscordSendPayload,
} from "../discord-connector.js";

/** One recorded call to a {@link FakeDiscordConnector} op, in call order. */
export type DiscordConnectorCall =
  | {
      op: "sendMessage";
      args: { channelId: string; payload: DiscordSendPayload };
    }
  | {
      op: "editMessage";
      args: {
        channelId: string;
        messageId: string;
        payload: DiscordSendPayload;
      };
    }
  | { op: "deleteMessage"; args: { channelId: string; messageId: string } }
  | { op: "sendTyping"; args: { channelId: string } }
  | { op: "fetchMessages"; args: { channelId: string; limit: number } }
  | { op: "fetchStarterMessage"; args: { channelId: string } }
  | {
      op: "addReaction";
      args: { channelId: string; messageId: string; emoji: string };
    }
  | {
      op: "removeReaction";
      args: { channelId: string; messageId: string; emoji: string };
    }
  | { op: "postFile"; args: { channelId: string; filename: string } }
  | { op: "sendDM"; args: { userId: string; payload: DiscordSendPayload } }
  | { op: "lookupUser"; args: { query: string } }
  | { op: "resolveUser"; args: { userId: string } }
  | { op: "registerCommands"; args: { commands: readonly CommandSpec[] } }
  | { op: "openModal"; args: { triggerId: string } };

/**
 * Per-op canned responses / failures a test can set on a {@link FakeDiscordConnector}
 * before exercising it. Anything left unset falls back to a harmless default
 * (an incrementing fake id, empty lists, etc.).
 */
export interface FakeDiscordConnectorResults {
  sendMessage?: { id?: string };
  postFile?: { id?: string };
  sendDM?: { id?: string; channelId?: string };
  fetchMessages?: DiscordConnectorMessage[];
  fetchStarterMessage?: DiscordConnectorMessage;
  lookupUser?: { id: string; name?: string; handle?: string };
  resolveUser?: { id: string; name?: string; handle?: string };
  openModal?: { ok: boolean; error?: string };
  /** Ops (by name) that should reject instead of resolving, with the given error. */
  throwing?: Partial<Record<DiscordConnectorCall["op"], Error>>;
}

/**
 * Records every call made to it (op + exact args, in order) and resolves with
 * configurable canned responses — the TDD fixture proving `DiscordAdapter`'s
 * egress methods route to the right {@link DiscordConnector} op with the right
 * args, without a real (or discord.js-shaped fake) Gateway/REST underneath.
 */
export class FakeDiscordConnector implements DiscordConnector {
  readonly calls: DiscordConnectorCall[] = [];
  private seq = 0;
  /** Set by {@link startIngress}; readable so a test can assert on the config it was handed. */
  ingressConfig: DiscordIngressConfig | undefined;
  /** True once {@link stopIngress} has been called. */
  ingressStopped = false;
  /** Every commands list passed to {@link registerCommands}, in order. */
  readonly registeredCommands: Array<readonly CommandSpec[]> = [];
  /**
   * Captured from {@link DiscordIngressConfig.sink} by {@link startIngress} —
   * the SAME `IngressSink` a real Gateway-backed connector would forward
   * normalized turns to. Lets {@link emitTurn} push a fake inbound turn
   * straight into the real channels-core dispatch (`sink.onTurn` → §2
   * `decideChannelResponse` → `thread.runAgent` → egress) without a real
   * Gateway socket — the Model-1 standalone proof.
   */
  private sink: IngressSink | undefined;

  constructor(readonly results: FakeDiscordConnectorResults = {}) {}

  private throwIfConfigured(op: DiscordConnectorCall["op"]): void {
    const err = this.results.throwing?.[op];
    if (err) throw err;
  }

  async sendMessage(
    channelId: string,
    payload: DiscordSendPayload,
  ): Promise<{ id: string }> {
    this.calls.push({ op: "sendMessage", args: { channelId, payload } });
    this.throwIfConfigured("sendMessage");
    return this.results.sendMessage?.id
      ? { id: this.results.sendMessage.id }
      : { id: `fake-msg-${++this.seq}` };
  }

  async editMessage(
    channelId: string,
    messageId: string,
    payload: DiscordSendPayload,
  ): Promise<void> {
    this.calls.push({
      op: "editMessage",
      args: { channelId, messageId, payload },
    });
    this.throwIfConfigured("editMessage");
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    this.calls.push({ op: "deleteMessage", args: { channelId, messageId } });
    this.throwIfConfigured("deleteMessage");
  }

  async sendTyping(channelId: string): Promise<void> {
    this.calls.push({ op: "sendTyping", args: { channelId } });
    this.throwIfConfigured("sendTyping");
  }

  async fetchMessages(
    channelId: string,
    opts: { limit: number },
  ): Promise<DiscordConnectorMessage[]> {
    this.calls.push({
      op: "fetchMessages",
      args: { channelId, limit: opts.limit },
    });
    this.throwIfConfigured("fetchMessages");
    return this.results.fetchMessages ?? [];
  }

  async fetchStarterMessage(
    channelId: string,
  ): Promise<DiscordConnectorMessage | undefined> {
    this.calls.push({ op: "fetchStarterMessage", args: { channelId } });
    this.throwIfConfigured("fetchStarterMessage");
    return this.results.fetchStarterMessage;
  }

  async addReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    this.calls.push({
      op: "addReaction",
      args: { channelId, messageId, emoji },
    });
    this.throwIfConfigured("addReaction");
  }

  async removeReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    this.calls.push({
      op: "removeReaction",
      args: { channelId, messageId, emoji },
    });
    this.throwIfConfigured("removeReaction");
  }

  async postFile(
    channelId: string,
    file: { bytes: Uint8Array; filename: string },
  ): Promise<{ id: string }> {
    this.calls.push({
      op: "postFile",
      args: { channelId, filename: file.filename },
    });
    this.throwIfConfigured("postFile");
    return this.results.postFile?.id
      ? { id: this.results.postFile.id }
      : { id: `fake-file-${++this.seq}` };
  }

  async sendDM(
    userId: string,
    payload: DiscordSendPayload,
  ): Promise<{ id: string; channelId: string }> {
    this.calls.push({ op: "sendDM", args: { userId, payload } });
    this.throwIfConfigured("sendDM");
    return {
      id: this.results.sendDM?.id ?? `fake-dm-msg-${++this.seq}`,
      channelId:
        this.results.sendDM?.channelId ?? `fake-dm-channel-${this.seq}`,
    };
  }

  async lookupUser(query: string) {
    this.calls.push({ op: "lookupUser", args: { query } });
    this.throwIfConfigured("lookupUser");
    return this.results.lookupUser;
  }

  async resolveUser(userId: string) {
    this.calls.push({ op: "resolveUser", args: { userId } });
    this.throwIfConfigured("resolveUser");
    return this.results.resolveUser ?? { id: userId };
  }

  registerCommands(commands: readonly CommandSpec[]): void {
    this.calls.push({ op: "registerCommands", args: { commands } });
    this.registeredCommands.push(commands);
  }

  async openModal(triggerId: string) {
    this.calls.push({ op: "openModal", args: { triggerId } });
    this.throwIfConfigured("openModal");
    return this.results.openModal ?? { ok: true };
  }

  /**
   * No real Gateway socket here — records the config it was handed (so a test
   * can assert on `resolveUser`) and captures `config.sink` (see
   * {@link emitTurn}) so a test can drive fake inbound turns through it.
   * Resolves with a canned connection.
   */
  async startIngress(
    config: DiscordIngressConfig,
  ): Promise<DiscordIngressConnection> {
    this.ingressConfig = config;
    this.sink = config.sink;
    return { botUserId: "BOTFAKE" };
  }

  async stopIngress(): Promise<void> {
    this.ingressStopped = true;
  }

  /**
   * Push a fake inbound turn through the `sink` captured by {@link startIngress}
   * — the Model-1 standalone proof's ingress entry point. Mirrors
   * `FakeSlackConnector.emitTurn`, but RETURNS the underlying `sink.onTurn`
   * promise (rather than firing-and-forgetting) so a test can `await` a turn
   * all the way through §2's `decideChannelResponse` → `thread.runAgent` →
   * egress before asserting, instead of racing a `setTimeout(0)` tick.
   *
   * Throws if ingress hasn't started yet (`channel.start()`/
   * `DiscordAdapter.start()` not called) — this proves the standalone dispatch
   * wiring, so a call before `start()` is a test bug, not a tolerable no-op.
   */
  emitTurn(
    turn: Partial<IncomingTurn> & { conversationKey: string },
  ): Promise<void> {
    if (!this.sink) {
      throw new Error(
        "FakeDiscordConnector.emitTurn: ingress not started — call " +
          "channel.start() (which calls DiscordAdapter.start()) first",
      );
    }
    return Promise.resolve(
      this.sink.onTurn({
        replyTarget: { channelId: "C1" },
        userText: "",
        platform: "discord",
        ...turn,
      }),
    );
  }
}

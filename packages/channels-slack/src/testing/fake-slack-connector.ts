import type {
  ChatPostMessageArguments,
  ChatUpdateArguments,
  ChatDeleteArguments,
  ChatPostEphemeralArguments,
  ChatStartStreamArguments,
  ChatAppendStreamArguments,
  ChatStopStreamArguments,
  AssistantThreadsSetStatusArguments,
  AssistantThreadsSetSuggestedPromptsArguments,
  AssistantThreadsSetTitleArguments,
  UsersListArguments,
  UsersInfoArguments,
  ConversationsRepliesArguments,
  ConversationsHistoryArguments,
  FilesUploadV2Arguments,
  ReactionsAddArguments,
  ReactionsRemoveArguments,
  ViewsOpenArguments,
} from "@slack/web-api";
import type {
  SlackConnector,
  SlackConnectorMember,
  SlackConnectorUserDetail,
  SlackConnectorHistoryMessage,
  SlackConnectorDownloadResult,
  SlackIngressConfig,
  SlackIngressConnection,
} from "../slack-connector.js";
import type { IngressSink, IncomingTurn } from "@copilotkit/channels-core";

/** One recorded call to a {@link FakeSlackConnector} op, in call order. */
export type SlackConnectorCall =
  | { op: "postMessage"; args: ChatPostMessageArguments }
  | { op: "updateMessage"; args: ChatUpdateArguments }
  | { op: "deleteMessage"; args: ChatDeleteArguments }
  | { op: "setStatus"; args: AssistantThreadsSetStatusArguments }
  | { op: "startStream"; args: ChatStartStreamArguments }
  | { op: "appendStream"; args: ChatAppendStreamArguments }
  | { op: "stopStream"; args: ChatStopStreamArguments }
  | {
      op: "setSuggestedPrompts";
      args: AssistantThreadsSetSuggestedPromptsArguments;
    }
  | { op: "setThreadTitle"; args: AssistantThreadsSetTitleArguments }
  | { op: "listUsers"; args: UsersListArguments }
  | { op: "getUserInfo"; args: UsersInfoArguments }
  | { op: "getReplies"; args: ConversationsRepliesArguments }
  | { op: "getHistory"; args: ConversationsHistoryArguments }
  | { op: "uploadFile"; args: FilesUploadV2Arguments }
  | { op: "downloadFile"; args: { url: string } }
  | { op: "addReaction"; args: ReactionsAddArguments }
  | { op: "removeReaction"; args: ReactionsRemoveArguments }
  | { op: "postEphemeral"; args: ChatPostEphemeralArguments }
  | { op: "openModal"; args: ViewsOpenArguments };

/**
 * Per-op canned responses / failures a test can set on a {@link FakeSlackConnector}
 * before exercising it. Anything left unset falls back to a harmless default
 * (an incrementing fake `ts`, empty lists, etc.).
 */
export interface FakeSlackConnectorResults {
  postMessage?: { ts?: string; channel?: string };
  startStream?: { ts?: string; channel?: string };
  listUsers?: {
    members?: SlackConnectorMember[];
    response_metadata?: { next_cursor?: string };
  };
  getUserInfo?: { user?: SlackConnectorUserDetail };
  getReplies?: { messages?: SlackConnectorHistoryMessage[] };
  getHistory?: { messages?: SlackConnectorHistoryMessage[] };
  postEphemeral?: { message_ts?: string };
  downloadFile?: SlackConnectorDownloadResult;
  /** Ops (by name) that should reject instead of resolving, with the given error. */
  throwing?: Partial<Record<SlackConnectorCall["op"], Error>>;
}

/**
 * Records every call made to it (op + exact args, in order) and resolves with
 * configurable canned responses — the TDD fixture proving `SlackAdapter`'s
 * egress methods route to the right {@link SlackConnector} op with the right
 * args, without a real (or WebClient-shaped fake) Slack API underneath.
 */
export class FakeSlackConnector implements SlackConnector {
  readonly calls: SlackConnectorCall[] = [];
  private seq = 0;
  /** Set by {@link startIngress}; readable so a test can assert on the config it was handed. */
  ingressConfig: SlackIngressConfig | undefined;
  /** True once {@link stopIngress} has been called. */
  ingressStopped = false;
  /**
   * Captured from {@link SlackIngressConfig.sink} by {@link startIngress} —
   * the SAME `IngressSink` a real Bolt-backed connector would forward
   * normalized turns to. Lets {@link emitTurn} push a fake inbound turn
   * straight into the real channels-core dispatch (`sink.onTurn` → §2
   * `decideChannelResponse` → `thread.runAgent` → egress) without a real
   * Bolt socket — the Model-1 standalone proof (Task 3/T3s-4b).
   */
  private sink: IngressSink | undefined;

  constructor(readonly results: FakeSlackConnectorResults = {}) {}

  private throwIfConfigured(op: SlackConnectorCall["op"]): void {
    const err = this.results.throwing?.[op];
    if (err) throw err;
  }

  async postMessage(
    args: ChatPostMessageArguments,
  ): Promise<{ ts?: string; channel?: string }> {
    this.calls.push({ op: "postMessage", args });
    this.throwIfConfigured("postMessage");
    return (
      this.results.postMessage ?? {
        ts: `fake-ts-${++this.seq}`,
        channel: args.channel,
      }
    );
  }

  async updateMessage(args: ChatUpdateArguments): Promise<void> {
    this.calls.push({ op: "updateMessage", args });
    this.throwIfConfigured("updateMessage");
  }

  async deleteMessage(args: ChatDeleteArguments): Promise<void> {
    this.calls.push({ op: "deleteMessage", args });
    this.throwIfConfigured("deleteMessage");
  }

  async setStatus(args: AssistantThreadsSetStatusArguments): Promise<void> {
    this.calls.push({ op: "setStatus", args });
    this.throwIfConfigured("setStatus");
  }

  async startStream(
    args: ChatStartStreamArguments,
  ): Promise<{ ts?: string; channel?: string }> {
    this.calls.push({ op: "startStream", args });
    this.throwIfConfigured("startStream");
    return (
      this.results.startStream ?? {
        ts: `fake-stream-ts-${++this.seq}`,
        channel: args.channel,
      }
    );
  }

  async appendStream(args: ChatAppendStreamArguments): Promise<void> {
    this.calls.push({ op: "appendStream", args });
    this.throwIfConfigured("appendStream");
  }

  async stopStream(args: ChatStopStreamArguments): Promise<void> {
    this.calls.push({ op: "stopStream", args });
    this.throwIfConfigured("stopStream");
  }

  async setSuggestedPrompts(
    args: AssistantThreadsSetSuggestedPromptsArguments,
  ): Promise<void> {
    this.calls.push({ op: "setSuggestedPrompts", args });
    this.throwIfConfigured("setSuggestedPrompts");
  }

  async setThreadTitle(args: AssistantThreadsSetTitleArguments): Promise<void> {
    this.calls.push({ op: "setThreadTitle", args });
    this.throwIfConfigured("setThreadTitle");
  }

  async listUsers(args: UsersListArguments): Promise<{
    members?: SlackConnectorMember[];
    response_metadata?: { next_cursor?: string };
  }> {
    this.calls.push({ op: "listUsers", args });
    this.throwIfConfigured("listUsers");
    return this.results.listUsers ?? {};
  }

  async getUserInfo(
    args: UsersInfoArguments,
  ): Promise<{ user?: SlackConnectorUserDetail }> {
    this.calls.push({ op: "getUserInfo", args });
    this.throwIfConfigured("getUserInfo");
    return this.results.getUserInfo ?? {};
  }

  async getReplies(
    args: ConversationsRepliesArguments,
  ): Promise<{ messages?: SlackConnectorHistoryMessage[] }> {
    this.calls.push({ op: "getReplies", args });
    this.throwIfConfigured("getReplies");
    return this.results.getReplies ?? {};
  }

  async getHistory(
    args: ConversationsHistoryArguments,
  ): Promise<{ messages?: SlackConnectorHistoryMessage[] }> {
    this.calls.push({ op: "getHistory", args });
    this.throwIfConfigured("getHistory");
    return this.results.getHistory ?? {};
  }

  async uploadFile(args: FilesUploadV2Arguments): Promise<void> {
    this.calls.push({ op: "uploadFile", args });
    this.throwIfConfigured("uploadFile");
  }

  async downloadFile(url: string): Promise<SlackConnectorDownloadResult> {
    this.calls.push({ op: "downloadFile", args: { url } });
    this.throwIfConfigured("downloadFile");
    return this.results.downloadFile ?? { ok: true, bytes: Buffer.alloc(0) };
  }

  async addReaction(args: ReactionsAddArguments): Promise<void> {
    this.calls.push({ op: "addReaction", args });
    this.throwIfConfigured("addReaction");
  }

  async removeReaction(args: ReactionsRemoveArguments): Promise<void> {
    this.calls.push({ op: "removeReaction", args });
    this.throwIfConfigured("removeReaction");
  }

  async postEphemeral(
    args: ChatPostEphemeralArguments,
  ): Promise<{ message_ts?: string }> {
    this.calls.push({ op: "postEphemeral", args });
    this.throwIfConfigured("postEphemeral");
    return (
      this.results.postEphemeral ?? { message_ts: `fake-eph-${++this.seq}` }
    );
  }

  async openModal(args: ViewsOpenArguments): Promise<void> {
    this.calls.push({ op: "openModal", args });
    this.throwIfConfigured("openModal");
  }

  /**
   * No real Bolt socket here — records the config it was handed (so a test
   * can assert on `respondTo`/`assistant`/callbacks) and captures `config.sink`
   * (see {@link emitTurn}) so a test can drive fake inbound turns through it.
   * Resolves with a canned connection. Raw Slack-shaped ingress (app_mention/
   * message payloads) is still exercised against `WebClientSlackConnector`
   * directly / `attachSlackListener` — this fake only proves what happens
   * AFTER a turn reaches the sink.
   */
  async startIngress(
    config: SlackIngressConfig,
  ): Promise<SlackIngressConnection> {
    this.ingressConfig = config;
    this.sink = config.sink;
    return { botUserId: "UFAKEBOT", teamId: "TFAKE" };
  }

  async stopIngress(): Promise<void> {
    this.ingressStopped = true;
  }

  /**
   * Push a fake inbound turn through the `sink` captured by {@link startIngress}
   * — the Model-1 standalone proof's ingress entry point. Mirrors channels-core's
   * `FakeAdapter.emitTurn`, but RETURNS the underlying `sink.onTurn` promise
   * (rather than firing-and-forgetting) so a test can `await` a turn all the
   * way through §2's `decideChannelResponse` → `thread.runAgent` → egress
   * before asserting, instead of racing a `setTimeout(0)` tick.
   *
   * Throws if ingress hasn't started yet (`channel.start()`/`SlackAdapter.start()`
   * not called) — this proves the standalone dispatch wiring, so a call before
   * `start()` is a test bug, not a tolerable no-op.
   */
  emitTurn(
    turn: Partial<IncomingTurn> & { conversationKey: string },
  ): Promise<void> {
    if (!this.sink) {
      throw new Error(
        "FakeSlackConnector.emitTurn: ingress not started — call " +
          "channel.start() (which calls SlackAdapter.start()) first",
      );
    }
    return Promise.resolve(
      this.sink.onTurn({
        replyTarget: { channel: "C1" },
        userText: "",
        platform: "slack",
        ...turn,
      }),
    );
  }
}

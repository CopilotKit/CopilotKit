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
   * can assert on `respondTo`/`assistant`/callbacks) and resolves with a
   * canned connection. Never fires any handler on its own; a test drives
   * ingress behavior against `WebClientSlackConnector` directly instead.
   */
  async startIngress(
    config: SlackIngressConfig,
  ): Promise<SlackIngressConnection> {
    this.ingressConfig = config;
    return { botUserId: "UFAKEBOT", teamId: "TFAKE" };
  }

  async stopIngress(): Promise<void> {
    this.ingressStopped = true;
  }
}

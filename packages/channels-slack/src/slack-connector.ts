import type {
  WebClient,
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
  FilesUploadV2Arguments,
  ReactionsAddArguments,
  ReactionsRemoveArguments,
  ViewsOpenArguments,
} from "@slack/web-api";

/** A member row from `users.list`, as consumed by `SlackAdapter.lookupUser`. */
export interface SlackConnectorMember {
  id?: string;
  name?: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: { display_name?: string; email?: string };
}

/** A user detail row from `users.info`, as consumed by `SlackAdapter.resolveUser`. */
export interface SlackConnectorUserDetail {
  id?: string;
  name?: string;
  real_name?: string;
  profile?: { real_name?: string; display_name?: string; email?: string };
}

/** A history message row from `conversations.replies`, as consumed by `SlackAdapter.getMessages`. */
export interface SlackConnectorHistoryMessage {
  text?: string;
  ts?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
}

/**
 * Every credentialed Slack egress operation `SlackAdapter` performs, behind a
 * port whose method signatures carry only serializable data (channel/ts/
 * text/blocks/etc.) — never a `WebClient` instance or a token. That's the
 * whole point: the managed Connector Outbox implements this SAME interface
 * with its own credentialed sender, and a custom runner can supply another.
 *
 * Subsumes the two transports the adapter already injected — the run
 * renderer's {@link SlackRenderTransport} (render/transport.ts: setStatus/
 * postMessage/updateMessage) and the {@link NativeStreamTransport}
 * (native-stream.ts: startStream/appendStream/stopStream) — plus every other
 * `this.client.*` call `SlackAdapter`'s egress methods used to make inline
 * (delete/reactions/ephemeral/file/suggestedPrompts/title/history/lookup/
 * modal). Argument shapes reuse `@slack/web-api`'s plain `*Arguments`
 * interfaces: already bounded, serializable data, so this is a pass-through
 * of what the adapter already builds — only the *sender* moves behind the
 * port. Native-vs-legacy transport choice (the `nativeStreamingOk` /
 * `nativeTaskChunksOk` health flags) stays adapter-side; the connector only
 * executes whichever call the adapter decides to make.
 */
export interface SlackConnector {
  /** `chat.postMessage` — post a message (post ~341, legacy stream placeholder ~379, render transport ~513). */
  postMessage(
    args: ChatPostMessageArguments,
  ): Promise<{ ts?: string; channel?: string }>;
  /** `chat.update` — edit an existing message (update ~364, legacy stream ~394, render transport ~519). */
  updateMessage(args: ChatUpdateArguments): Promise<void>;
  /** `chat.delete` (~570). */
  deleteMessage(args: ChatDeleteArguments): Promise<void>;
  /** `assistant.threads.setStatus` — the render transport's "is thinking…" indicator (~510). */
  setStatus(args: AssistantThreadsSetStatusArguments): Promise<void>;

  /** `chat.startStream` — begin a native streamed message (~467). */
  startStream(
    args: ChatStartStreamArguments,
  ): Promise<{ ts?: string; channel?: string }>;
  /** `chat.appendStream` — append text or structured chunks to a streamed message (~478/486). */
  appendStream(args: ChatAppendStreamArguments): Promise<void>;
  /** `chat.stopStream` — finalize a native streamed message (~496). */
  stopStream(args: ChatStopStreamArguments): Promise<void>;

  /** `assistant.threads.setSuggestedPrompts` — pane-only prompt chips (~655). */
  setSuggestedPrompts(
    args: AssistantThreadsSetSuggestedPromptsArguments,
  ): Promise<void>;
  /** `assistant.threads.setTitle` — pane-only thread title (~686). */
  setThreadTitle(args: AssistantThreadsSetTitleArguments): Promise<void>;

  /** `users.list` — paged workspace member listing, backs `lookupUser` (~707). */
  listUsers(args: UsersListArguments): Promise<{
    members?: SlackConnectorMember[];
    response_metadata?: { next_cursor?: string };
  }>;
  /** `users.info` — backs `resolveUser` (~755). */
  getUserInfo(
    args: UsersInfoArguments,
  ): Promise<{ user?: SlackConnectorUserDetail }>;

  /** `conversations.replies` — backs `getMessages` (~829). */
  getReplies(
    args: ConversationsRepliesArguments,
  ): Promise<{ messages?: SlackConnectorHistoryMessage[] }>;

  /** `files.uploadV2` — backs `postFile` (~888). */
  uploadFile(args: FilesUploadV2Arguments): Promise<void>;

  /** `reactions.add` (~907). */
  addReaction(args: ReactionsAddArguments): Promise<void>;
  /** `reactions.remove` (~928). */
  removeReaction(args: ReactionsRemoveArguments): Promise<void>;

  /** `chat.postEphemeral` — backs `postEphemeral` (~955). */
  postEphemeral(
    args: ChatPostEphemeralArguments,
  ): Promise<{ message_ts?: string }>;

  /** `views.open` — backs `openModal` (~1006). */
  openModal(args: ViewsOpenArguments): Promise<void>;
}

/**
 * The transitional / custom-runner / local-dev {@link SlackConnector}: wraps a
 * `WebClient` (built from `botToken`/`appToken`) and holds the exact
 * credentialed calls `SlackAdapter`'s egress methods used to make inline
 * before this port existed. The Intelligence Connector Outbox supplies its
 * own implementation of this same interface.
 */
export class WebClientSlackConnector implements SlackConnector {
  constructor(private readonly client: WebClient) {}

  async postMessage(
    args: ChatPostMessageArguments,
  ): Promise<{ ts?: string; channel?: string }> {
    const res = await this.client.chat.postMessage(args);
    return { ts: res.ts, channel: res.channel };
  }

  async updateMessage(args: ChatUpdateArguments): Promise<void> {
    await this.client.chat.update(args);
  }

  async deleteMessage(args: ChatDeleteArguments): Promise<void> {
    await this.client.chat.delete(args);
  }

  async setStatus(args: AssistantThreadsSetStatusArguments): Promise<void> {
    await this.client.assistant.threads.setStatus(args);
  }

  async startStream(
    args: ChatStartStreamArguments,
  ): Promise<{ ts?: string; channel?: string }> {
    const res = await this.client.chat.startStream(args);
    return { ts: res.ts, channel: res.channel };
  }

  async appendStream(args: ChatAppendStreamArguments): Promise<void> {
    await this.client.chat.appendStream(args);
  }

  async stopStream(args: ChatStopStreamArguments): Promise<void> {
    await this.client.chat.stopStream(args);
  }

  async setSuggestedPrompts(
    args: AssistantThreadsSetSuggestedPromptsArguments,
  ): Promise<void> {
    await this.client.assistant.threads.setSuggestedPrompts(args);
  }

  async setThreadTitle(args: AssistantThreadsSetTitleArguments): Promise<void> {
    await this.client.assistant.threads.setTitle(args);
  }

  async listUsers(args: UsersListArguments): Promise<{
    members?: SlackConnectorMember[];
    response_metadata?: { next_cursor?: string };
  }> {
    const r = (await this.client.users.list(args)) as {
      members?: SlackConnectorMember[];
      response_metadata?: { next_cursor?: string };
    };
    return r;
  }

  async getUserInfo(
    args: UsersInfoArguments,
  ): Promise<{ user?: SlackConnectorUserDetail }> {
    const r = (await this.client.users.info(args)) as {
      user?: SlackConnectorUserDetail;
    };
    return r;
  }

  async getReplies(
    args: ConversationsRepliesArguments,
  ): Promise<{ messages?: SlackConnectorHistoryMessage[] }> {
    const r = (await this.client.conversations.replies(args)) as {
      messages?: SlackConnectorHistoryMessage[];
    };
    return r;
  }

  async uploadFile(args: FilesUploadV2Arguments): Promise<void> {
    await this.client.files.uploadV2(args);
  }

  async addReaction(args: ReactionsAddArguments): Promise<void> {
    await this.client.reactions.add(args);
  }

  async removeReaction(args: ReactionsRemoveArguments): Promise<void> {
    await this.client.reactions.remove(args);
  }

  async postEphemeral(
    args: ChatPostEphemeralArguments,
  ): Promise<{ message_ts?: string }> {
    const res = await this.client.chat.postEphemeral(args);
    return { message_ts: (res as { message_ts?: string }).message_ts };
  }

  async openModal(args: ViewsOpenArguments): Promise<void> {
    await this.client.views.open(args);
  }
}

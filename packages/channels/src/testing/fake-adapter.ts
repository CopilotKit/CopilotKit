import type { AgentSubscriber } from "@ag-ui/client";
import type {
  BotNode,
  MessageRef,
  PlatformUser,
  ThreadMessage,
} from "@copilotkit/channels-ui";
import type {
  PlatformAdapter,
  SurfaceCapabilities,
  IngressSink,
  IncomingTurn,
  IncomingThreadStart,
  InteractionEvent,
  IncomingCommand,
  RunRenderer,
  CapturedToolCall,
  CapturedInterrupt,
  ReplyTarget,
  NativePayload,
  UserQuery,
  ConversationStore,
  IncomingReaction,
  IncomingModalSubmit,
  IncomingModalClose,
  ModalSubmitResult,
} from "../platform-adapter.js";
import type { CommandSpec } from "../commands.js";
import type { StateStore } from "../state/state-store.js";

/** A RunRenderer whose subscriber captures tool-call-end and custom (interrupt) events — used by run-loop tests. */
export function makeFakeRunRenderer(): RunRenderer {
  const toolCalls: CapturedToolCall[] = [];
  let pending: CapturedInterrupt | undefined;
  const subscriber: AgentSubscriber = {
    onToolCallEndEvent(p) {
      toolCalls.push({
        toolCallId: p.event.toolCallId,
        toolCallName: p.toolCallName,
        toolCallArgs: (p.toolCallArgs ?? {}) as Record<string, unknown>,
      });
    },
    onCustomEvent(p) {
      const e = p.event as { name?: string; value?: unknown };
      if (e.name) pending = { eventName: e.name, value: e.value };
    },
  };
  let finishCalls = 0;
  return {
    subscriber,
    async markInterrupted() {},
    getCapturedToolCalls: () => toolCalls,
    getPendingInterrupt: () => pending,
    clearPendingInterrupt: () => {
      pending = undefined;
    },
    async finish() {
      finishCalls++;
    },
    get finishCalls() {
      return finishCalls;
    },
  } as RunRenderer & { readonly finishCalls: number };
}

export class FakeAdapter implements PlatformAdapter {
  platform = "fake";
  readonly capabilities: SurfaceCapabilities;
  readonly ackDeadlineMs = 3000;

  /** When true, `start()` rejects (set via constructor `failStart`). */
  readonly failStart: boolean;
  /** When true, `registerCommands()` rejects (set via constructor `failRegisterCommands`). */
  readonly failRegisterCommands: boolean;
  /** When true, `stop()` rejects (set via constructor `failStop`). */
  readonly failStop: boolean;
  /** Set once `start()` has run to completion; lets tests assert a healthy adapter still started. */
  started = false;

  /**
   * @param fakeOpts.paneMethods When `false`, the optional
   *   `setSuggestedPrompts`/`setThreadTitle` methods are omitted (and the
   *   matching capability flags cleared) so tests can exercise the
   *   capability-gated `{ ok: false }` path. Defaults to present.
   * @param fakeOpts.reactions When `false`, `addReaction`/`removeReaction` are
   *   omitted and `supportsReactions` is cleared. Defaults to present.
   * @param fakeOpts.nativeEphemeral When `true`, `postEphemeral` reports a
   *   native success (`usedFallback: false`) and `supportsEphemeral` is set;
   *   otherwise DM-fallback / `null` semantics apply and `supportsEphemeral`
   *   is `false`.
   * @param fakeOpts.modals When `false`, `renderModal`/`openModal` are omitted
   *   and `supportsModals` is `false`. Defaults to present.
   */
  constructor(
    fakeOpts: {
      paneMethods?: boolean;
      reactions?: boolean;
      nativeEphemeral?: boolean;
      modals?: boolean;
      /** Platform name override (defaults to "fake"); useful when a test needs distinct adapters. */
      platform?: string;
      /** When true, `start()` rejects — simulates an adapter that fails to come up. */
      failStart?: boolean;
      /** When true, `registerCommands()` rejects — simulates a command-registration failure. */
      failRegisterCommands?: boolean;
      /** When true, `stop()` rejects — simulates a shutdown failure. */
      failStop?: boolean;
    } = {},
  ) {
    if (fakeOpts.platform) this.platform = fakeOpts.platform;
    this.failStart = fakeOpts.failStart === true;
    this.failRegisterCommands = fakeOpts.failRegisterCommands === true;
    this.failStop = fakeOpts.failStop === true;
    const paneMethods = fakeOpts.paneMethods !== false;
    this.capabilities = {
      supportsModals: fakeOpts.modals !== false,
      supportsTyping: false,
      supportsReactions: fakeOpts.reactions !== false,
      supportsStreaming: true,
      supportsSuggestedPrompts: paneMethods,
      supportsThreadTitle: paneMethods,
      supportsEphemeral: fakeOpts.nativeEphemeral === true,
    };
    if (paneMethods) {
      this.setSuggestedPrompts = async (target, prompts, opts) => {
        this.suggestedPromptsCalls.push({ target, prompts, opts });
        return { ok: true };
      };
      this.setThreadTitle = async (target, title) => {
        this.threadTitleCalls.push({ target, title });
        return { ok: true };
      };
    }
    if (fakeOpts.reactions !== false) {
      this.addReaction = async (_t, ref, e) => {
        this.reactionsAdded.push({ ref, emoji: e });
        return { ok: true };
      };
      this.removeReaction = async (_t, ref, e) => {
        this.reactionsRemoved.push({ ref, emoji: e });
        return { ok: true };
      };
    }
    // Native ephemeral when nativeEphemeral === true; otherwise DM-fallback semantics.
    this.postEphemeral = async (_t, user, ir, opts) => {
      this.ephemeralPosts.push({ user, ir, opts });
      if (this.capabilities.supportsEphemeral) {
        return {
          ok: true,
          usedFallback: false,
          ref: { id: `eph-${++this.counter}` },
        };
      }
      if (opts.fallbackToDM) {
        return {
          ok: true,
          usedFallback: true,
          ref: { id: `dm-${++this.counter}` },
        };
      }
      return null;
    };
    if (fakeOpts.modals !== false) {
      this.renderModal = (ir) => ir;
      this.openModal = async (_t, triggerId, ir) => {
        this.openedModals.push({ triggerId, ir });
        return { ok: true };
      };
    }
  }
  readonly conversationStore: ConversationStore = {
    async getOrCreate(conversationKey, _replyTarget, makeAgent) {
      return { agent: makeAgent(conversationKey) };
    },
  };

  posted: BotNode[][] = [];
  updated: { ref: MessageRef; ir: BotNode[] }[] = [];
  interactionsSeen: InteractionEvent[] = [];
  lastRunRenderer?: RunRenderer;
  /** History returned by getMessages(); override in tests. */
  messages: ThreadMessage[] = [];
  /** User returned by lookupUser(); override in tests. */
  user?: PlatformUser;
  /** Optional persistence backend the adapter provides (test-only); exercises createChannel's store resolution. */
  stateStore?: StateStore;
  private sink?: IngressSink;
  private counter = 0;

  /** Expose the registered sink so tests can invoke onTurn() directly for overlap/lock tests. */
  getSink(): IngressSink {
    if (!this.sink)
      throw new Error("FakeAdapter: sink not set — call channel.start() first");
    return this.sink;
  }

  async start(sink: IngressSink): Promise<void> {
    if (this.failStart) throw new Error("fake-adapter: start failed");
    this.sink = sink;
    this.started = true;
  }
  async stop(): Promise<void> {
    if (this.failStop) throw new Error("fake-adapter: stop failed");
  }

  render(ir: BotNode[]): NativePayload {
    return ir;
  }
  async post(_target: ReplyTarget, ir: BotNode[]): Promise<MessageRef> {
    this.posted.push(ir);
    return { id: `msg-${++this.counter}` };
  }
  async update(ref: MessageRef, ir: BotNode[]): Promise<void> {
    this.updated.push({ ref, ir });
  }
  async stream(
    _target: ReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    let s = "";
    for await (const c of chunks) s += c;
    this.posted.push([{ type: "text", props: { value: s } }]);
    return { id: `msg-${++this.counter}` };
  }
  async delete(_ref: MessageRef): Promise<void> {}

  createRunRenderer(_target: ReplyTarget): RunRenderer {
    const r = makeFakeRunRenderer();
    this.lastRunRenderer = r;
    return r;
  }
  decodeInteraction(raw: unknown): InteractionEvent | undefined {
    return raw as InteractionEvent;
  }
  async lookupUser(_q: UserQuery): Promise<PlatformUser | undefined> {
    return this.user;
  }
  async getMessages(_target: ReplyTarget): Promise<ThreadMessage[]> {
    return this.messages;
  }

  /** Suggested-prompt calls recorded by the capability-gated method (when present). */
  suggestedPromptsCalls: {
    target: ReplyTarget;
    prompts: ReadonlyArray<{ title: string; message: string }>;
    opts?: { title?: string };
  }[] = [];
  setSuggestedPrompts?: PlatformAdapter["setSuggestedPrompts"];

  /** Thread-title calls recorded by the capability-gated method (when present). */
  threadTitleCalls: { target: ReplyTarget; title: string }[] = [];
  setThreadTitle?: PlatformAdapter["setThreadTitle"];

  // --- reactions ---
  reactionsAdded: { ref: MessageRef; emoji: string }[] = [];
  reactionsRemoved: { ref: MessageRef; emoji: string }[] = [];
  addReaction?: PlatformAdapter["addReaction"];
  removeReaction?: PlatformAdapter["removeReaction"];

  // --- ephemeral ---
  ephemeralPosts: {
    user: unknown;
    ir: BotNode[];
    opts: { fallbackToDM: boolean };
  }[] = [];
  postEphemeral?: PlatformAdapter["postEphemeral"];

  // --- modals ---
  openedModals: { triggerId: string; ir: BotNode[] }[] = [];
  renderModal?: PlatformAdapter["renderModal"];
  openModal?: PlatformAdapter["openModal"];

  // --- test helpers ---
  emitTurn(partial: Partial<IncomingTurn>): void {
    void this.sink?.onTurn({
      conversationKey: "c",
      replyTarget: {},
      userText: "",
      platform: "fake",
      ...partial,
    });
  }
  emitThreadStarted(
    partial?: Partial<IncomingThreadStart>,
  ): Promise<void> | void {
    return this.sink?.onThreadStarted({
      conversationKey: "c",
      replyTarget: {},
      platform: "fake",
      ...partial,
    });
  }
  emitInteraction(partial: Partial<InteractionEvent>): void {
    const evt: InteractionEvent = {
      id: "",
      conversationKey: "c",
      replyTarget: {},
      ...partial,
    };
    this.interactionsSeen.push(evt);
    void this.sink?.onInteraction(evt);
  }
  emitCommand(
    partial: Partial<IncomingCommand> & { command: string },
  ): Promise<void> | void {
    return this.sink?.onCommand({
      text: "",
      conversationKey: "c",
      replyTarget: {},
      platform: "fake",
      ...partial,
    });
  }
  emitReaction(
    partial: Partial<IncomingReaction> & { rawEmoji: string },
  ): Promise<void> | void {
    return this.sink?.onReaction({
      added: true,
      conversationKey: "c",
      replyTarget: {},
      messageId: "m1",
      raw: {},
      ...partial,
    });
  }
  emitModalSubmit(
    partial: Partial<IncomingModalSubmit> & { callbackId: string },
  ): Promise<ModalSubmitResult | void> | undefined {
    return this.sink?.onModalSubmit({
      values: {},
      platform: "fake",
      raw: {},
      ...partial,
    });
  }
  emitModalClose(
    partial: Partial<IncomingModalClose> & { callbackId: string },
  ): Promise<void> | void {
    return this.sink?.onModalClose({ platform: "fake", raw: {}, ...partial });
  }

  /** Commands handed to the adapter via `registerCommands`; asserts the capability hook fires. */
  registeredCommands?: readonly CommandSpec[];
  async registerCommands(commands: readonly CommandSpec[]): Promise<void> {
    if (this.failRegisterCommands)
      throw new Error("fake-adapter: registerCommands failed");
    this.registeredCommands = commands;
  }
}

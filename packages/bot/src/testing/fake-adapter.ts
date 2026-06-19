import type { AgentSubscriber } from "@ag-ui/client";
import type {
  BotNode,
  MessageRef,
  PlatformUser,
  ThreadMessage,
} from "@copilotkit/bot-ui";
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
} from "../platform-adapter.js";
import type { CommandSpec } from "../commands.js";

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
  readonly platform = "fake";
  readonly capabilities: SurfaceCapabilities;
  readonly ackDeadlineMs = 3000;

  /**
   * @param fakeOpts.paneMethods When `false`, the optional
   *   `setSuggestedPrompts`/`setThreadTitle` methods are omitted (and the
   *   matching capability flags cleared) so tests can exercise the
   *   capability-gated `{ ok: false }` path. Defaults to present.
   */
  constructor(fakeOpts: { paneMethods?: boolean } = {}) {
    const paneMethods = fakeOpts.paneMethods !== false;
    this.capabilities = {
      supportsModals: false,
      supportsTyping: false,
      supportsReactions: false,
      supportsStreaming: true,
      supportsSuggestedPrompts: paneMethods,
      supportsThreadTitle: paneMethods,
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
  private sink?: IngressSink;
  private counter = 0;

  async start(sink: IngressSink): Promise<void> {
    this.sink = sink;
  }
  async stop(): Promise<void> {}

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

  /** Commands handed to the adapter via `registerCommands`; asserts the capability hook fires. */
  registeredCommands?: readonly CommandSpec[];
  registerCommands(commands: readonly CommandSpec[]): void {
    this.registeredCommands = commands;
  }
}

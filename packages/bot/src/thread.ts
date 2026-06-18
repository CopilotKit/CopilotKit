import type { PlatformAdapter, ReplyTarget } from "./platform-adapter.js";
import type { ActionRegistry } from "./action-registry.js";
import type {
  AgentContentPart,
  Renderable,
  MessageRef,
  PlatformUser,
  ThreadMessage,
  Thread as ThreadInterface,
} from "@copilotkit/bot-ui";
import { runAgentLoop } from "./run-loop.js";
import { toAgentToolDescriptors } from "./tools.js";
import type {
  BotTool,
  BotToolContext,
  ContextEntry,
  AgentToolDescriptor,
} from "./tools.js";
import type { AbstractAgent } from "@ag-ui/client";

export interface ThreadDeps {
  adapter: PlatformAdapter;
  replyTarget: ReplyTarget;
  conversationKey: string;
  registry: ActionRegistry;
  agentFactory: (threadId: string) => AbstractAgent;
  tools: Map<string, BotTool>;
  toolDescriptors: AgentToolDescriptor[];
  context: ContextEntry[];
  registerWaiter: (
    conversationKey: string,
    resolve: (value: unknown) => void,
  ) => void;
  interruptHandlers: Map<
    string,
    (args: { payload: unknown; thread: Thread }) => void | Promise<void>
  >;
}

/** A concrete conversation thread: posts UI, runs the agent loop, and resolves HITL waiters. */
export class Thread implements ThreadInterface {
  readonly platform: string;

  constructor(private deps: ThreadDeps) {
    this.platform = deps.adapter.platform;
  }

  private async bindForPost(ui: Renderable) {
    return this.deps.registry.bindRenderable(ui, this.deps.conversationKey);
  }

  async post(ui: Renderable): Promise<MessageRef> {
    return this.deps.adapter.post(
      this.deps.replyTarget,
      await this.bindForPost(ui),
    );
  }

  async update(ref: MessageRef, ui: Renderable): Promise<MessageRef> {
    await this.deps.adapter.update(ref, await this.bindForPost(ui));
    return ref;
  }

  async delete(ref: MessageRef): Promise<void> {
    await this.deps.adapter.delete(ref);
  }

  async stream(src: string | AsyncIterable<string>): Promise<MessageRef> {
    const iter =
      typeof src === "string"
        ? (async function* () {
            yield src;
          })()
        : src;
    return this.deps.adapter.stream(this.deps.replyTarget, iter);
  }

  async postFile(args: {
    bytes: Uint8Array;
    filename: string;
    title?: string;
    altText?: string;
  }): Promise<{ ok: boolean; fileId?: string; error?: string }> {
    const adapter = this.deps.adapter;
    if (!adapter.postFile) {
      return {
        ok: false,
        error: `${this.platform} does not support file upload`,
      };
    }
    return adapter.postFile(this.deps.replyTarget, args);
  }

  /** Pin suggested prompts (returns `{ ok: false }` on surfaces without support). */
  async setSuggestedPrompts(
    prompts: ReadonlyArray<{ title: string; message: string }>,
    opts?: { title?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const adapter = this.deps.adapter;
    if (!adapter.setSuggestedPrompts) {
      return {
        ok: false,
        error: `${this.platform} does not support suggested prompts`,
      };
    }
    return adapter.setSuggestedPrompts(this.deps.replyTarget, prompts, opts);
  }

  /** Name this conversation (returns `{ ok: false }` on surfaces without support). */
  async setTitle(title: string): Promise<{ ok: boolean; error?: string }> {
    const adapter = this.deps.adapter;
    if (!adapter.setThreadTitle) {
      return {
        ok: false,
        error: `${this.platform} does not support thread titles`,
      };
    }
    return adapter.setThreadTitle(this.deps.replyTarget, title);
  }

  /** Read the conversation's messages (returns `[]` when the adapter can't read history). */
  async getMessages(): Promise<ThreadMessage[]> {
    return (await this.deps.adapter.getMessages?.(this.deps.replyTarget)) ?? [];
  }

  /** Resolve a platform user by free-form query (returns `undefined` when unsupported). */
  async lookupUser(query: string): Promise<PlatformUser | undefined> {
    return this.deps.adapter.lookupUser?.({ query });
  }

  /** Post a picker and wait until an interaction in this conversation resolves it. */
  async awaitChoice<T = unknown>(ui: Renderable): Promise<T> {
    const p = new Promise<T>((resolve) =>
      this.deps.registerWaiter(
        this.deps.conversationKey,
        resolve as (value: unknown) => void,
      ),
    );
    await this.post(ui);
    return p;
  }

  async runAgent(input?: {
    context?: ContextEntry[];
    tools?: BotTool[];
    /**
     * A user message to inject before running. Needed when the input isn't
     * already in the conversation history the adapter reconstructs — e.g. a
     * slash command, whose args are never posted to the channel. A
     * `AgentContentPart[]` carries multimodal content (e.g. inbound image/file
     * attachments) the model can read.
     */
    prompt?: string | AgentContentPart[];
  }): Promise<MessageRef | undefined> {
    return this.run(undefined, input);
  }

  async resume(value: unknown): Promise<MessageRef | undefined> {
    return this.run({ resume: value });
  }

  private async run(
    initialResume?: { resume: unknown },
    extra?: {
      context?: ContextEntry[];
      tools?: BotTool[];
      prompt?: string | AgentContentPart[];
    },
  ): Promise<MessageRef | undefined> {
    const session = await this.deps.adapter.conversationStore.getOrCreate(
      this.deps.conversationKey,
      this.deps.replyTarget,
      this.deps.agentFactory,
    );
    // Inject an explicit user message when the input isn't in the adapter's
    // reconstructed history (e.g. a slash command's args, or inbound image/file
    // attachments built into multimodal content parts). A non-empty array is
    // truthy, so this guard also admits multimodal prompts.
    if (extra?.prompt) {
      session.agent.addMessage({
        id: globalThis.crypto.randomUUID(),
        role: "user",
        // AG-UI types `content` as `string`, but multimodal works at runtime by
        // setting it to an `AgentContentPart[]` — the runtime's LLM adapter
        // converts the parts to the provider's multimodal format. We cast to
        // satisfy the string-typed field (bot-slack parity — it does the same
        // when assigning multimodal `content` to its reconstructed messages).
        content: extra.prompt as unknown as string,
      });
    }
    const renderer = this.deps.adapter.createRunRenderer(this.deps.replyTarget);

    // Merge per-run context/tools (this run only) on top of the bot-level deps.
    const extraTools = extra?.tools ?? [];
    let tools = this.deps.tools;
    let toolDescriptors = this.deps.toolDescriptors;
    if (extraTools.length > 0) {
      tools = new Map(this.deps.tools);
      for (const t of extraTools) tools.set(t.name, t);
      toolDescriptors = [
        ...this.deps.toolDescriptors,
        ...toAgentToolDescriptors(extraTools),
      ];
    }
    const context = extra?.context?.length
      ? [...this.deps.context, ...extra.context]
      : this.deps.context;

    await runAgentLoop({
      agent: session.agent,
      renderer,
      tools,
      toolDescriptors,
      context,
      makeToolCtx: (): BotToolContext => ({
        thread: this,
        platform: this.platform,
      }),
      handleInterrupt: async (interrupt) => {
        const h = this.deps.interruptHandlers.get(interrupt.eventName);
        if (h) await h({ payload: interrupt.value, thread: this });
      },
      initialResume,
    });
    return undefined;
  }
}

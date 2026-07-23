import type { PlatformAdapter, ReplyTarget } from "./platform-adapter.js";
import type { ActionRegistry } from "./action-registry.js";
import type {
  AgentContentPart,
  Renderable,
  MessageRef,
  PlatformUser,
  ThreadMessage,
  IncomingMessage,
  Thread as ThreadInterface,
  EmojiValue,
  EphemeralResult,
  ReactElementLike,
} from "@copilotkit/channels-ui";
import { runAgentLoop } from "./run-loop.js";
import { errorClass, normalizePlatform } from "./telemetry/sanitize-error.js";
import type { Transcripts } from "./transcripts.js";
import { toAgentToolDescriptors } from "./tools.js";
import type {
  ChannelTool,
  ChannelToolContext,
  ContextEntry,
  AgentToolDescriptor,
} from "./tools.js";
import type { AbstractAgent } from "@ag-ui/client";
import type { StateStore } from "./state/state-store.js";
import { validateSchema } from "./standard-schema.js";
import type { StandardSchemaV1 } from "./standard-schema.js";
import type { RenderConfig, ResolvedRenderConfig } from "./render/config.js";
import type { PostImageOptions } from "@copilotkit/channels-ui";
import { resolveArbitraryElement } from "./render/detect.js";

async function defaultRenderImage(
  node: unknown,
  cfg: ResolvedRenderConfig,
): Promise<Uint8Array> {
  const { renderJsxToPng } = await import("./render/takumi.js");
  return renderJsxToPng(node, cfg);
}

export interface ThreadDeps {
  adapter: PlatformAdapter;
  replyTarget: ReplyTarget;
  conversationKey: string;
  registry: ActionRegistry;
  agentFactory: (threadId: string) => AbstractAgent;
  tools: Map<string, ChannelTool>;
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
  /** Pluggable persistence. Injected by createChannel; always required. */
  state: StateStore;
  /**
   * Optional Standard Schema for per-thread state. When set, `setState`
   * validates its argument before persisting and throws on a schema mismatch.
   */
  stateSchema?: StandardSchemaV1;
  /** Cross-platform transcript store. Present only when `store.transcripts` is configured. */
  transcripts?: Transcripts;
  /** Resolved cross-platform identity key for this turn (if any). */
  userKey?: string;
  /** The inbound message that triggered this turn (for transcript bridging). */
  message?: IncomingMessage;
  /**
   * Optional anonymous telemetry sink. Structural type (not the concrete
   * ChannelTelemetry) avoids an import cycle; the real ChannelTelemetry satisfies it.
   */
  telemetry?: {
    capture(event: string, properties: Record<string, unknown>): void;
  };
  /** Channel-wide image-render config (fonts + compiled CSS), from createChannel({ render }). */
  render?: RenderConfig;
  /**
   * Test seam: override the image renderer. Defaults to a lazy import of the
   * Takumi render module, so `takumi-js` loads only when an image is posted.
   */
  renderImage?: (
    node: unknown,
    cfg: ResolvedRenderConfig,
  ) => Promise<Uint8Array>;
}

/** A concrete conversation thread: posts UI, runs the agent loop, and resolves HITL waiters. */
export class Thread implements ThreadInterface {
  readonly platform: string;
  /** Stable key identifying this conversation (used by transcript bridging). */
  readonly conversationKey: string;
  /** Mirrors the adapter's `supportsBlockingChoice` capability (see SurfaceCapabilities). */
  readonly supportsBlockingChoice?: boolean;
  private readonly store: StateStore;

  constructor(private deps: ThreadDeps) {
    this.platform = deps.adapter.platform;
    this.conversationKey = deps.conversationKey;
    this.supportsBlockingChoice =
      deps.adapter.capabilities.supportsBlockingChoice;
    this.store = deps.state;
  }

  private async bindForPost(ui: Renderable) {
    return this.deps.registry.bindRenderable(ui, this.deps.conversationKey);
  }

  /**
   * Wire a posted message's `onReaction` to its returned id: cache it for this
   * process and, when it came from a component, persist a durable snapshot so a
   * reaction after a restart re-derives it (parity with a component `onClick`).
   */
  private async bindReaction(
    messageId: string,
    bound: Awaited<ReturnType<Thread["bindForPost"]>>,
  ): Promise<void> {
    if (bound.onReaction) {
      this.deps.registry.registerMessageReaction(messageId, bound.onReaction);
    }
    if (bound.reactionComponent) {
      await this.deps.registry.persistMessageReaction(messageId, {
        ...bound.reactionComponent,
        conversationKey: this.deps.conversationKey,
      });
    }
  }

  async post(
    ui: Renderable | ReactElementLike,
    opts?: PostImageOptions,
  ): Promise<MessageRef> {
    const el = resolveArbitraryElement(ui);
    if (el) return this.postImage(el, opts);
    const bound = await this.bindForPost(ui as Renderable);
    const ref = await this.deps.adapter.post(this.deps.replyTarget, bound.root);
    await this.bindReaction(ref.id, bound);
    return ref;
  }

  /**
   * Render a resolved React element to a PNG via the configured (or default
   * lazy Takumi) renderer, then upload it through `postFile`.
   */
  private async postImage(
    node: unknown,
    opts?: PostImageOptions,
  ): Promise<MessageRef> {
    const g = this.deps.render ?? {};
    const cfg: ResolvedRenderConfig = {
      fonts: opts?.fonts ?? g.fonts ?? [],
      stylesheets: opts?.stylesheets ?? g.stylesheets ?? [],
      width: opts?.width ?? g.width ?? 720,
      height: opts?.height ?? g.height ?? 480,
    };
    const renderFn = this.deps.renderImage ?? defaultRenderImage;
    const bytes = await renderFn(node, cfg);
    const res = await this.postFile({
      bytes,
      filename: opts?.filename ?? "image.png",
      title: opts?.title,
      altText: opts?.altText,
    });
    if (!res.ok) {
      throw new Error(
        `post(image): upload failed — ${res.error ?? "unknown error"}`,
      );
    }
    return { id: res.fileId ?? "" };
  }

  async update(ref: MessageRef, ui: Renderable): Promise<MessageRef> {
    if (resolveArbitraryElement(ui)) {
      throw new Error(
        "thread.update does not support arbitrary JSX (an image post can't be edited in place). Post a new image instead.",
      );
    }
    const bound = await this.bindForPost(ui);
    await this.deps.adapter.update(ref, bound.root);
    await this.bindReaction(ref.id, bound);
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

  /** Add an emoji reaction to a message (capability-gated; `{ ok: false }` on surfaces without support). */
  async react(
    messageRef: MessageRef,
    emoji: EmojiValue,
  ): Promise<{ ok: boolean; error?: string }> {
    const adapter = this.deps.adapter;
    if (!adapter.addReaction) {
      return {
        ok: false,
        error: `${this.platform} does not support reactions`,
      };
    }
    return adapter.addReaction(this.deps.replyTarget, messageRef, emoji);
  }

  /** Remove the channel's emoji reaction from a message (capability-gated). */
  async unreact(
    messageRef: MessageRef,
    emoji: EmojiValue,
  ): Promise<{ ok: boolean; error?: string }> {
    const adapter = this.deps.adapter;
    if (!adapter.removeReaction) {
      return {
        ok: false,
        error: `${this.platform} does not support reactions`,
      };
    }
    return adapter.removeReaction(this.deps.replyTarget, messageRef, emoji);
  }

  /**
   * Post a message only `user` can see. `fallbackToDM` is required:
   * `true` → DM the user when native ephemeral is unsupported; `false` →
   * resolve to `null` when native ephemeral is unsupported.
   */
  async postEphemeral(
    user: PlatformUser | string,
    ui: Renderable,
    opts: { fallbackToDM: boolean },
  ): Promise<EphemeralResult | null> {
    if (resolveArbitraryElement(ui)) {
      throw new Error(
        "thread.postEphemeral does not support arbitrary JSX. Post an image with thread.post, or pass channel components.",
      );
    }
    const adapter = this.deps.adapter;
    if (!adapter.postEphemeral) {
      return {
        ok: false,
        error: `${this.platform} does not support ephemeral messages`,
      };
    }
    // Ephemeral messages can't be reacted to, so any `onReaction` is dropped
    // (stripped by bindForPost) rather than registered.
    const { root } = await this.bindForPost(ui);
    return adapter.postEphemeral(this.deps.replyTarget, user, root, opts);
  }

  // Subscription STORAGE lands here; subscription ROUTING (onSubscribedMessage) is deferred.

  /** Record this conversation as subscribed (persisted in state). Proactive delivery to subscribed conversations is not yet wired. */
  async subscribe(): Promise<void> {
    await this.store.kv.set(`sub:${this.deps.conversationKey}`, true);
  }

  /** Remove the subscription for this conversation. */
  async unsubscribe(): Promise<void> {
    await this.store.kv.delete(`sub:${this.deps.conversationKey}`);
  }

  /** Returns true if this conversation is currently subscribed. */
  async isSubscribed(): Promise<boolean> {
    return (
      (await this.store.kv.get<boolean>(`sub:${this.deps.conversationKey}`)) ===
      true
    );
  }

  /** Persist arbitrary per-thread state (e.g. workflow step). */
  async setState<T>(v: T): Promise<void> {
    let value: unknown = v;
    if (this.deps.stateSchema) {
      const r = await validateSchema(this.deps.stateSchema, v);
      if (!r.ok) throw new Error(`thread.setState: invalid state — ${r.error}`);
      value = r.value;
    }
    await this.store.kv.set(`threadstate:${this.deps.conversationKey}`, value);
  }

  /** Read back per-thread state previously written with `setState`. */
  async state<T>(): Promise<T | undefined> {
    return this.store.kv.get<T>(`threadstate:${this.deps.conversationKey}`);
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
    if (resolveArbitraryElement(ui)) {
      throw new Error(
        "thread.awaitChoice does not support arbitrary JSX — it needs interactive channel components (e.g. Button/Select). Use thread.post to send an image.",
      );
    }
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
    tools?: ChannelTool[];
    /**
     * A user message to inject before running. Needed when the input isn't
     * already in the conversation history the adapter reconstructs — e.g. a
     * slash command, whose args are never posted to the channel. A
     * `AgentContentPart[]` carries multimodal content (e.g. inbound image/file
     * attachments) the model can read.
     */
    prompt?: string | AgentContentPart[];
    /**
     * Auto-bridge cross-platform transcripts for this run. When truthy AND the
     * thread has a resolved `userKey` AND a `Transcripts` instance, this:
     *   1. injects prior history (`transcripts.list`, default limit 20) as a
     *      context entry,
     *   2. appends the current user turn,
     *   3. runs the agent,
     *   4. captures the assistant reply and appends it.
     * This flag OWNS the bridge — callers using it should NOT also manually
     * append the same user/assistant turn via `channel.transcripts.append`.
     * No-ops with a one-time warning when identity/transcripts aren't configured.
     */
    transcript?: boolean | { limit?: number };
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
      tools?: ChannelTool[];
      prompt?: string | AgentContentPart[];
      transcript?: boolean | { limit?: number };
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
        // satisfy the string-typed field (channels-slack parity — it does the same
        // when assigning multimodal `content` to its reconstructed messages).
        content: extra.prompt as unknown as string,
      });
    }
    const renderer = this.deps.adapter.createRunRenderer(this.deps.replyTarget);

    // Transcript auto-bridge (step 1 + 2): inject prior cross-platform history
    // as a context entry, then append the current user turn. This flag owns the
    // bridge — see `runAgent`'s `transcript` doc. No-ops with one warning when
    // identity/transcripts aren't configured.
    const transcripts = this.deps.transcripts;
    const userKey = this.deps.userKey;
    let transcriptContext: ContextEntry | undefined;
    if (extra?.transcript) {
      if (transcripts && userKey) {
        const limit =
          typeof extra.transcript === "object"
            ? (extra.transcript.limit ?? 20)
            : 20;
        // List BEFORE appending the current user turn so the current message
        // isn't counted as its own "prior history".
        const prior = await transcripts.list({ userKey, limit });
        if (prior.length > 0) {
          transcriptContext = {
            description: `Prior cross-platform conversation history with this user. Current channel: ${this.platform}.`,
            value: prior
              .map((e) => `[${e.platform}] ${e.role}: ${e.text}`)
              .join("\n"),
          };
        }
        if (this.deps.message) {
          await transcripts.append(this, this.deps.message, { userKey });
        }
      } else {
        warnTranscriptIgnored();
      }
    }

    // Merge per-run context/tools (this run only) on top of the channel-level deps.
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
    const context: ContextEntry[] = [
      ...this.deps.context,
      ...(transcriptContext ? [transcriptContext] : []),
      ...(extra?.context ?? []),
    ];

    // Snapshot the message count BEFORE the loop so we can isolate the
    // assistant messages this run produced (step 4).
    const messagesBefore = session.agent.messages.length;

    const startedAt = Date.now();
    let loopResult: { iterations: number; interrupted: boolean };
    // Telemetry stage: "agent" while the run loop runs, "finalize" for the
    // transcript-append + renderer.finish() steps below. A throw in either is
    // reported as agent_run_failed (with the right stage) instead of being
    // hidden behind an already-sent success event.
    let stage: "agent" | "finalize" = "agent";
    try {
      loopResult = await runAgentLoop({
        agent: session.agent,
        renderer,
        tools,
        toolDescriptors,
        context,
        makeToolCtx: (): ChannelToolContext => ({
          thread: this,
          platform: this.platform,
        }),
        handleInterrupt: async (interrupt) => {
          const h = this.deps.interruptHandlers.get(interrupt.eventName);
          if (h) await h({ payload: interrupt.value, thread: this });
        },
        initialResume,
      });
      stage = "finalize";
      // Transcript auto-bridge (step 4): capture the assistant text this run
      // produced and append it. Only when the bridge actually applied (transcripts
      // + userKey both present and `transcript` was requested).
      if (extra?.transcript && transcripts && userKey) {
        const produced = session.agent.messages.slice(messagesBefore);
        const text = produced
          .filter(
            (m) =>
              m.role === "assistant" &&
              typeof m.content === "string" &&
              m.content.trim().length > 0,
          )
          .map((m) => m.content as string)
          .join("\n\n");
        if (text.length > 0) {
          await transcripts.append(
            this,
            { role: "assistant", text },
            { userKey },
          );
        }
      }

      // Turn-end hook: lets a renderer finalize any turn-scoped resource it kept
      // open across runAgent iterations (e.g. a native streaming message). A
      // no-op for renderers whose per-message streams already self-terminate, and
      // for runs that were interrupted (the renderer guards that internally).
      await renderer.finish?.();
    } catch (err) {
      // A throw is a run failure — in the agent loop (tool-handler errors are
      // swallowed inside the loop, so a throw is agent-level) or in finalization.
      // `stage` distinguishes the two.
      this.deps.telemetry?.capture("oss.channel.agent_run_failed", {
        platform: normalizePlatform(this.platform),
        errorClass: errorClass(err),
        stage,
      });
      throw err;
    }
    // Emit success ONLY after the loop AND finalization both completed, so a
    // late transcript/finish rejection can never follow a success event.
    this.deps.telemetry?.capture("oss.channel.agent_run", {
      platform: normalizePlatform(this.platform),
      durationMs: Date.now() - startedAt,
      toolCallCount: renderer.getCapturedToolCalls().length,
      iterations: loopResult.iterations,
      interrupted: loopResult.interrupted,
    });
    return undefined;
  }
}

let transcriptWarned = false;
/** Warn once when `runAgent({ transcript })` is used without identity/transcripts configured. */
function warnTranscriptIgnored(): void {
  if (transcriptWarned) return;
  transcriptWarned = true;
  console.warn(
    "[channel] runAgent({ transcript }) ignored — configure store.identity + store.transcripts so a userKey resolves",
  );
}

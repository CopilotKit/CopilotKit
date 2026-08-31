import type { PlatformAdapter, ReplyTarget } from "./platform-adapter.js";
import type { ActionRegistry } from "./action-registry.js";
import type {
  ActionContinuationContext,
  ActionContinuationSnapshot,
} from "./action-store.js";
import type {
  AgentContentPart,
  Renderable,
  MessageRef,
  ProviderActor,
  ApplicationUser,
  ThreadMessage,
  IncomingMessage,
  Thread as ThreadInterface,
  EmojiValue,
  EphemeralResult,
  ReactElementLike,
  PostFileResult,
  ChannelNode,
} from "@copilotkit/channels-ui";
import { runAgentLoop } from "./run-loop.js";
import type { RunLoopArgs } from "./run-loop.js";
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
import { resolveRenders } from "./render/resolve-renders.js";
import { validateRenderTree } from "./render/validate-render.js";
import { defaultAllowImageUrl } from "./render/url-policy.js";
import { hasMemoryAccess, resolveMemoryGrant } from "./memory.js";
import type { MemoryGrant, ResolvedChannelMemory } from "./memory.js";
import type { ChannelComponentRenderContext } from "./channel-component.js";

/**
 * Warn once per platform that an image post produced no addressable message id.
 * Once per platform, not per post: on a surface that structurally never reports
 * one (the managed transport hands uploads to an async outbox) this would
 * otherwise fire on every single image.
 */
const warnedNoMessageId = new Set<string>();
function warnNoMessageId(platform: string): void {
  if (warnedNoMessageId.has(platform)) return;
  warnedNoMessageId.add(platform);
  console.warn(
    `[channel] post(image): the upload reported no message id on ${platform}; ` +
      "the returned ref cannot be used for delete/react/update (the upload itself succeeded)",
  );
}

async function defaultRenderImage(
  node: unknown,
  cfg: ResolvedRenderConfig,
): Promise<Uint8Array> {
  const { renderJsxToPng } = await import("./render/takumi.js");
  return renderJsxToPng(node, cfg);
}

/**
 * Default retention for a captured interrupt value (7 days) — deliberately the
 * same default the action store uses, so the retained value and the button that
 * consumes it expire together. If a channel configures a LONGER
 * `actionRetentionMs`, the value can lapse before the button does; a resume then
 * simply omits `command.interruptEvent`, which is exactly the pre-existing
 * behaviour rather than a new failure.
 */
const DEFAULT_INTERRUPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** A Channel run requested Memory without an attached Intelligence backend. */
export class ChannelMemoryUnavailableError extends Error {
  readonly code = "channel_memory_unavailable";

  constructor() {
    super("Channel Memory requires an attached Intelligence Runtime");
    this.name = "ChannelMemoryUnavailableError";
  }
}

/** A Channel run requested personal Memory without an application user. */
export class ChannelMemoryUserRequiredError extends Error {
  readonly code = "channel_memory_user_required";

  constructor() {
    super("Channel user Memory requires an identified application user");
    this.name = "ChannelMemoryUserRequiredError";
  }
}

/** A personal-Memory resume omitted the trusted principal selector. */
export class ChannelMemorySubjectRequiredError extends Error {
  readonly code = "channel_memory_subject_required";

  constructor() {
    super(
      'Channel user Memory on resume requires subject "initiator" or "actor"',
    );
    this.name = "ChannelMemorySubjectRequiredError";
  }
}

/** A resume was not triggered by a persisted one-use action capability. */
export class ChannelContinuationRequiredError extends Error {
  readonly code = "channel_continuation_required";

  constructor() {
    super("Channel resume requires a valid interaction continuation");
    this.name = "ChannelContinuationRequiredError";
  }
}

export interface ThreadDeps {
  adapter: PlatformAdapter;
  /** Source provider for this ingress event; falls back to the adapter identity. */
  platform?: string;
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
    (args: {
      payload: unknown;
      thread: Thread;
      user: ApplicationUser | null;
      actor: ProviderActor;
    }) => void | Promise<void>
  >;
  /** Pluggable persistence. Injected by createChannel; always required. */
  state: StateStore;
  /**
   * How long a captured interrupt value is retained so `resume` can echo it back
   * as `command.interruptEvent`. Should match the action retention, since the
   * button that triggers the resume is what bounds its useful life. Defaults to
   * {@link DEFAULT_INTERRUPT_RETENTION_MS}.
   */
  interruptRetentionMs?: number;
  /**
   * Optional Standard Schema for per-thread state. When set, `setState`
   * validates its argument before persisting and throws on a schema mismatch.
   */
  stateSchema?: StandardSchemaV1;
  /** Cross-platform transcript store. Present only when `store.transcripts` is configured. */
  transcripts?: Transcripts;
  /** The inbound message that triggered this turn (for transcript bridging). */
  message?: IncomingMessage;
  /** Fallback prompt for agent runs with neither an explicit nor an inbound prompt. */
  defaultPrompt?: string;
  user: ApplicationUser | null;
  actor: ProviderActor;
  /** Declared Channel identity bound to one-use continuations. */
  channelName: string;
  /** Trusted canonical Thread identity bound to one-use continuations. */
  threadId: string;
  /** Action capability that created this interaction Thread. */
  interactionActionId?: string;
  /** Set only when the owning Runtime attached Intelligence Memory. */
  intelligenceMemoryAvailable?: boolean;
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

/** Stable rejection for surfaces that cannot hold one run open for a choice. */
class ChannelAwaitChoiceNotSupportedError extends Error {
  readonly code = "channel_await_choice_not_supported";

  constructor() {
    super(
      "Managed Channels v1 does not support Thread.awaitChoice(); post the picker in an onInterrupt handler and call Thread.resume() from the later interaction delivery.",
    );
    this.name = "ChannelAwaitChoiceNotSupportedError";
  }
}

/** A concrete conversation thread: posts UI, runs the agent loop, and resolves HITL waiters. */
export class Thread implements ThreadInterface {
  readonly platform: string;
  /** Stable key identifying this conversation (used by transcript bridging). */
  readonly conversationKey: string;
  /** Mirrors the adapter's `supportsBlockingChoice` capability (see SurfaceCapabilities). */
  readonly supportsBlockingChoice?: boolean;
  private readonly store: StateStore;
  private implicitInboundConsumed = false;
  private activeContinuation?: ActionContinuationContext;
  private agentRunTail: Promise<void> = Promise.resolve();

  constructor(private deps: ThreadDeps) {
    this.platform = deps.platform ?? deps.adapter.platform;
    this.conversationKey = deps.conversationKey;
    this.supportsBlockingChoice =
      deps.adapter.capabilities.supportsBlockingChoice;
    this.store = deps.state;
  }

  private async bindForPost(ui: Renderable) {
    return this.deps.registry.bindRenderable(
      ui,
      this.deps.conversationKey,
      this.activeContinuation,
      {
        platform: this.platform as ChannelComponentRenderContext["platform"],
        signal: new AbortController().signal,
      },
    );
  }

  /**
   * Validate bound IR and rewrite every `<Render>` to a staged `image` node.
   * `bound.root` may be one node or an array; the return matches `adapter.post`.
   */
  private async prepareNative(
    root: ChannelNode | readonly ChannelNode[],
  ): Promise<ChannelNode[]> {
    const roots = Array.isArray(root) ? root : [root];
    validateRenderTree(roots);
    if (!containsType(roots, "render")) return roots;
    if (!this.deps.adapter.stageFile) {
      throw new Error(
        `channels.render: ${this.platform} does not support stageFile`,
      );
    }
    const g = this.deps.render ?? {};
    return resolveRenders(roots, {
      renderJsxToPng: this.deps.renderImage ?? defaultRenderImage,
      stageFile: (args) =>
        this.deps.adapter.stageFile!(this.deps.replyTarget, args),
      defaultWidth: 800,
      defaultHeight: g.height ?? 480,
      fonts: g.fonts,
      stylesheets: g.stylesheets,
      allowImageUrl: g.allowImageUrl,
    });
  }

  private trackOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.deps.adapter.trackThreadOperation) {
      try {
        return operation();
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return this.deps.adapter.trackThreadOperation(
      this.deps.replyTarget,
      operation,
    );
  }

  /** Keep one Thread's agent runs isolated while preserving failure independence. */
  private enqueueAgentRun<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.agentRunTail.then(operation, operation);
    this.agentRunTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
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

  post(
    ui: Renderable | ReactElementLike,
    opts?: PostImageOptions,
  ): Promise<MessageRef> {
    return this.trackOperation(async () => {
      const el = resolveArbitraryElement(ui);
      if (el) return this.postImage(el, opts);
      const bound = await this.bindForPost(ui as Renderable);
      const ir = await this.prepareNative(bound.root);
      const ref = await this.deps.adapter.post(this.deps.replyTarget, ir);
      await this.bindReaction(ref.id, bound);
      return ref;
    });
  }

  /**
   * Render a resolved React element to a PNG via the configured (or default
   * lazy Takumi) renderer, then upload it through `postFile`.
   */
  private async postImage(
    node: unknown,
    opts?: PostImageOptions,
  ): Promise<MessageRef> {
    // Fail fast BEFORE the (expensive) render if the surface can't upload files
    // at all — no point rasterizing a PNG we could never post.
    if (!this.deps.adapter.postFile) {
      throw new Error(
        `post(image): ${this.platform} does not support file upload`,
      );
    }
    const g = this.deps.render ?? {};
    const cfg: ResolvedRenderConfig = {
      fonts: opts?.fonts ?? g.fonts ?? [],
      stylesheets: opts?.stylesheets ?? g.stylesheets ?? [],
      width: opts?.width ?? g.width ?? 720,
      height: opts?.height ?? g.height ?? 480,
      // Channel-wide only (not per-post): a fetch policy is a security boundary,
      // and a per-call override is exactly the knob an injected tool argument
      // would reach for.
      allowImageUrl: g.allowImageUrl ?? defaultAllowImageUrl,
    };
    const renderFn = this.deps.renderImage ?? defaultRenderImage;
    const bytes = await renderFn(node, cfg);
    // Call the adapter directly. `this.postFile` also tracks the operation,
    // and we are already inside `post()`'s `trackOperation`.
    const res = await this.deps.adapter.postFile!(this.deps.replyTarget, {
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
    // Only a *message* id is a usable MessageRef. Platforms that upload media
    // separately from posting it (Slack, Telegram, WhatsApp) also return a
    // media id in `fileId`, which their delete/react/update APIs reject — so
    // never pass that off as a message id.
    if (!res.messageId) warnNoMessageId(this.platform);
    return { id: res.messageId ?? "" };
  }

  /** @internal Post a registered component through the normal bind and adapter path. */
  postRegisteredComponent(
    componentName: string,
    props: Record<string, unknown>,
    renderContext: ChannelComponentRenderContext,
  ): Promise<MessageRef> {
    return this.trackOperation(async () => {
      const bound = await this.deps.registry.bindRegisteredRenderable(
        componentName,
        props,
        this.deps.conversationKey,
        this.activeContinuation,
        renderContext,
      );
      const ir = await this.prepareNative(bound.root);
      const ref = await this.deps.adapter.post(this.deps.replyTarget, ir);
      await this.bindReaction(ref.id, bound);
      return ref;
    });
  }

  update(ref: MessageRef, ui: Renderable): Promise<MessageRef> {
    return this.trackOperation(async () => {
      if (resolveArbitraryElement(ui)) {
        throw new Error(
          "thread.update does not support arbitrary JSX (an image post can't be edited in place). Post a new image instead.",
        );
      }
      const bound = await this.bindForPost(ui);
      const ir = await this.prepareNative(bound.root);
      await this.deps.adapter.update(ref, ir);
      await this.bindReaction(ref.id, bound);
      return ref;
    });
  }

  delete(ref: MessageRef): Promise<void> {
    return this.trackOperation(() => this.deps.adapter.delete(ref));
  }

  stream(src: string | AsyncIterable<string>): Promise<MessageRef> {
    return this.trackOperation(() => {
      const iter =
        typeof src === "string"
          ? (async function* () {
              yield src;
            })()
          : src;
      return this.deps.adapter.stream(this.deps.replyTarget, iter);
    });
  }

  postFile(args: {
    bytes: Uint8Array;
    filename: string;
    title?: string;
    altText?: string;
  }): Promise<PostFileResult> {
    return this.trackOperation(async () => {
      const adapter = this.deps.adapter;
      if (!adapter.postFile) {
        return {
          ok: false,
          error: `${this.platform} does not support file upload`,
        };
      }
      return adapter.postFile(this.deps.replyTarget, args);
    });
  }

  /** Pin suggested prompts (returns `{ ok: false }` on surfaces without support). */
  setSuggestedPrompts(
    prompts: ReadonlyArray<{ title: string; message: string }>,
    opts?: { title?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    return this.trackOperation(async () => {
      const adapter = this.deps.adapter;
      if (!adapter.setSuggestedPrompts) {
        return {
          ok: false,
          error: `${this.platform} does not support suggested prompts`,
        };
      }
      return adapter.setSuggestedPrompts(this.deps.replyTarget, prompts, opts);
    });
  }

  /** Name this conversation (returns `{ ok: false }` on surfaces without support). */
  setTitle(title: string): Promise<{ ok: boolean; error?: string }> {
    return this.trackOperation(async () => {
      const adapter = this.deps.adapter;
      if (!adapter.setThreadTitle) {
        return {
          ok: false,
          error: `${this.platform} does not support thread titles`,
        };
      }
      return adapter.setThreadTitle(this.deps.replyTarget, title);
    });
  }

  /** Add an emoji reaction to a message (capability-gated; `{ ok: false }` on surfaces without support). */
  react(
    messageRef: MessageRef,
    emoji: EmojiValue,
  ): Promise<{ ok: boolean; error?: string }> {
    return this.trackOperation(async () => {
      const adapter = this.deps.adapter;
      if (!adapter.addReaction) {
        return {
          ok: false,
          error: `${this.platform} does not support reactions`,
        };
      }
      return adapter.addReaction(this.deps.replyTarget, messageRef, emoji);
    });
  }

  /** Remove the channel's emoji reaction from a message (capability-gated). */
  unreact(
    messageRef: MessageRef,
    emoji: EmojiValue,
  ): Promise<{ ok: boolean; error?: string }> {
    return this.trackOperation(async () => {
      const adapter = this.deps.adapter;
      if (!adapter.removeReaction) {
        return {
          ok: false,
          error: `${this.platform} does not support reactions`,
        };
      }
      return adapter.removeReaction(this.deps.replyTarget, messageRef, emoji);
    });
  }

  /**
   * Post a message only `user` can see. `fallbackToDM` is required:
   * `true` → DM the user when native ephemeral is unsupported; `false` →
   * resolve to `null` when native ephemeral is unsupported.
   */
  postEphemeral(
    user: ProviderActor | string,
    ui: Renderable,
    opts: { fallbackToDM: boolean },
  ): Promise<EphemeralResult | null> {
    return this.trackOperation(async () => {
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
    });
  }

  // Subscription STORAGE lands here; subscription ROUTING (onSubscribedMessage) is deferred.

  /** Record this conversation as subscribed (persisted in state). Proactive delivery to subscribed conversations is not yet wired. */
  subscribe(): Promise<void> {
    return this.trackOperation(() =>
      this.store.kv.set(`sub:${this.deps.conversationKey}`, true),
    );
  }

  /** Remove the subscription for this conversation. */
  unsubscribe(): Promise<void> {
    return this.trackOperation(() =>
      this.store.kv.delete(`sub:${this.deps.conversationKey}`),
    );
  }

  /** Returns true if this conversation is currently subscribed. */
  isSubscribed(): Promise<boolean> {
    return this.trackOperation(
      async () =>
        (await this.store.kv.get<boolean>(
          `sub:${this.deps.conversationKey}`,
        )) === true,
    );
  }

  /** Persist arbitrary per-thread state (e.g. workflow step). */
  setState<T>(v: T): Promise<void> {
    return this.trackOperation(async () => {
      let value: unknown = v;
      if (this.deps.stateSchema) {
        const r = await validateSchema(this.deps.stateSchema, v);
        if (!r.ok)
          throw new Error(`thread.setState: invalid state — ${r.error}`);
        value = r.value;
      }
      await this.store.kv.set(
        `threadstate:${this.deps.conversationKey}`,
        value,
      );
    });
  }

  /** Read back per-thread state previously written with `setState`. */
  state<T>(): Promise<T | undefined> {
    return this.trackOperation(() =>
      this.store.kv.get<T>(`threadstate:${this.deps.conversationKey}`),
    );
  }

  private interruptEventKey(): string {
    return `interruptevent:${this.deps.conversationKey}`;
  }

  /**
   * Retain the raw value of a captured interrupt so a later {@link resume} can
   * echo it back to the agent as `command.interruptEvent`.
   *
   * PERSISTED, not in-memory, because the resume arrives in a DIFFERENT run —
   * possibly in a different process after a restart, which is the whole reason
   * this HITL path exists. Stored per conversation, matching the fact that a
   * renderer tracks a single pending interrupt: a second interrupt in the same
   * conversation legitimately supersedes the first.
   *
   * Best-effort: an agent that needs no correlation data (LangGraph) resumes
   * fine without this, so a store failure must not take the interrupt down.
   */
  private async rememberInterruptEvent(value: unknown): Promise<void> {
    if (value === undefined) return;
    try {
      await this.store.kv.set(
        this.interruptEventKey(),
        value,
        this.deps.interruptRetentionMs ?? DEFAULT_INTERRUPT_RETENTION_MS,
      );
    } catch (err) {
      console.warn(
        "[channel] could not retain the interrupt value; a resume will omit " +
          "command.interruptEvent (fine for LangGraph, breaks Mastra):",
        err,
      );
    }
  }

  /** Read the conversation's messages (returns `[]` when the adapter can't read history). */
  getMessages(): Promise<ThreadMessage[]> {
    return this.trackOperation(
      async () =>
        (await this.deps.adapter.getMessages?.(this.deps.replyTarget)) ?? [],
    );
  }

  /** Resolve a platform user by free-form query (returns `undefined` when unsupported). */
  lookupUser(query: string): Promise<ProviderActor | undefined> {
    return this.trackOperation(() => this.deps.adapter.lookupUser({ query }));
  }

  /** Post a picker and wait until an interaction in this conversation resolves it. */
  awaitChoice<T = unknown>(ui: Renderable): Promise<T> {
    if (this.supportsBlockingChoice === false) {
      return Promise.reject(new ChannelAwaitChoiceNotSupportedError());
    }
    return this.trackOperation(async () => {
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
    });
  }

  runAgent(input?: {
    context?: ContextEntry[];
    tools?: ChannelTool[];
    /**
     * A user message to inject before running. When the adapter's conversation
     * store does not seed the in-flight turn, an omitted prompt defaults to
     * non-empty inbound `message.contentParts` or `message.text`. Welcome
     * handlers instead default to `"Introduce yourself to the channel!"`.
     * Pass a prompt explicitly to override either default or when input isn't in
     * reconstructed history — e.g. slash-command args, which are never posted to
     * the channel.
     */
    prompt?: string | AgentContentPart[];
    /**
     * Auto-bridge cross-platform transcripts for this run. When truthy AND the
     * thread has a resolved `userId` AND a `Transcripts` instance, this:
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
    /** Intelligence Memory access for this run only. Omission disables Memory. */
    memory?: MemoryGrant;
  }): Promise<MessageRef | undefined> {
    try {
      this.deps.adapter.assertRunAgentSupported?.(this.deps.replyTarget);
    } catch (error) {
      return Promise.reject(error);
    }
    const memoryRequest =
      input?.memory === undefined
        ? undefined
        : { user: input.memory.user, project: input.memory.project };
    return this.enqueueAgentRun(() =>
      this.trackOperation(async () => {
        const memory = this.resolveMemory(memoryRequest, this.deps.user);
        const message = this.deps.message;
        const inboundPrompt =
          message?.contentParts && message.contentParts.length > 0
            ? message.contentParts
            : message?.text;
        const implicitPrompt =
          input?.prompt === undefined &&
          !this.deps.adapter.conversationStore.seedsInboundTurn &&
          (!this.deps.adapter.injectInboundTurnOnce ||
            !this.implicitInboundConsumed);
        if (implicitPrompt && inboundPrompt) {
          this.implicitInboundConsumed = true;
        }
        const continuation: ActionContinuationContext = {
          channelName: this.deps.channelName,
          conversationKey: this.deps.conversationKey,
          threadId: this.deps.threadId,
          runChainId: globalThis.crypto.randomUUID(),
          initiator: { user: this.deps.user, actor: this.deps.actor },
        };
        this.activeContinuation = continuation;
        try {
          return await this.run(undefined, {
            ...input,
            memory,
            prompt:
              input?.prompt ??
              (implicitPrompt ? inboundPrompt : undefined) ??
              this.deps.defaultPrompt,
          });
        } finally {
          if (this.activeContinuation === continuation) {
            this.activeContinuation = undefined;
          }
        }
      }),
    );
  }

  resume(
    value: unknown,
    options?: {
      memory?: MemoryGrant;
      subject?: "initiator" | "actor";
    },
  ): Promise<MessageRef | undefined> {
    const memoryRequest =
      options?.memory === undefined
        ? undefined
        : { user: options.memory.user, project: options.memory.project };
    const subject = options?.subject;
    const actionId = this.deps.interactionActionId;
    if (!actionId) {
      return Promise.reject(new ChannelContinuationRequiredError());
    }
    return this.trackOperation(async () => {
      const binding = {
        channelName: this.deps.channelName,
        conversationKey: this.deps.conversationKey,
        threadId: this.deps.threadId,
      };
      const available = await this.deps.registry.getContinuation(
        actionId,
        binding,
      );
      const memory = this.resolveResumeMemory(
        memoryRequest === undefined && subject === undefined
          ? undefined
          : { memory: memoryRequest, subject },
        available,
      );
      const claimed = await this.deps.registry.claimContinuation(
        actionId,
        binding,
      );
      const continuation: ActionContinuationContext = {
        channelName: claimed.channelName,
        conversationKey: claimed.conversationKey,
        threadId: claimed.threadId,
        runChainId: claimed.runChainId,
        initiator: claimed.initiator,
      };
      this.activeContinuation = continuation;
      // Echo the originating interrupt back to the agent. Some AG-UI bridges
      // (e.g. @ag-ui/mastra) key their resume off it — it carries the correlation
      // ids identifying WHICH suspended call to continue — and silently ignore a
      // resume without it. LangGraph needs no correlation data and ignores the
      // extra field, so this is additive for existing agents.
      //
      // `consume` is atomic take-and-delete, matching the one-use continuation
      // claimed just above: a replayed click must not resurrect a spent resume.
      // Omitted entirely when absent, so the wire shape is byte-identical to
      // before for any flow that never captured an interrupt value.
      let interruptEvent: unknown;
      try {
        interruptEvent = await this.store.kv.consume(this.interruptEventKey());
      } catch (err) {
        console.warn(
          "[channel] could not read the retained interrupt value; resuming " +
            "without command.interruptEvent:",
          err,
        );
      }
      try {
        return await this.run(
          interruptEvent === undefined
            ? { resume: value }
            : { resume: value, interruptEvent },
          { memory },
        );
      } finally {
        if (this.activeContinuation === continuation) {
          this.activeContinuation = undefined;
        }
      }
    });
  }

  private resolveResumeMemory(
    options:
      | { memory?: MemoryGrant; subject?: "initiator" | "actor" }
      | undefined,
    continuation: ActionContinuationSnapshot,
  ): ResolvedChannelMemory | undefined {
    if (options?.memory === undefined) return undefined;
    const grant = resolveMemoryGrant(options.memory);
    if (!hasMemoryAccess(grant)) return undefined;
    let user: ApplicationUser | null = null;
    if (grant.user !== "none") {
      if (!options.subject) throw new ChannelMemorySubjectRequiredError();
      user =
        options.subject === "initiator"
          ? continuation.initiator.user
          : this.deps.user;
      if (user === null) throw new ChannelMemoryUserRequiredError();
    }
    this.assertMemoryAvailable();
    return Object.freeze({ grant, user });
  }

  private resolveMemory(
    requested: MemoryGrant | undefined,
    user: ApplicationUser | null,
  ): ResolvedChannelMemory | undefined {
    if (requested === undefined) return undefined;
    const grant = resolveMemoryGrant(requested);
    if (!hasMemoryAccess(grant)) return undefined;
    if (grant.user !== "none" && user === null) {
      throw new ChannelMemoryUserRequiredError();
    }
    this.assertMemoryAvailable();
    return Object.freeze({
      grant,
      user: grant.user === "none" ? null : user,
    });
  }

  private assertMemoryAvailable(): void {
    if (
      this.deps.intelligenceMemoryAvailable !== true &&
      this.deps.adapter.supportsIntelligenceMemory !== true
    ) {
      throw new ChannelMemoryUnavailableError();
    }
  }

  private async run(
    initialResume?: { resume: unknown; interruptEvent?: unknown },
    extra?: {
      context?: ContextEntry[];
      tools?: ChannelTool[];
      prompt?: string | AgentContentPart[];
      transcript?: boolean | { limit?: number };
      memory?: ResolvedChannelMemory;
    },
  ): Promise<MessageRef | undefined> {
    const session = await this.deps.adapter.conversationStore.getOrCreate(
      this.deps.conversationKey,
      this.deps.replyTarget,
      this.deps.agentFactory,
    );
    try {
      // Inject an explicit user message when the input isn't in the adapter's
      // reconstructed history (e.g. a slash command's args, or inbound image/file
      // attachments built into multimodal content parts). A non-empty array is
      // truthy, so this guard also admits multimodal prompts.
      const promptAlreadySeeded =
        this.deps.adapter.conversationStore.seedsInboundTurn &&
        promptMatchesInbound(extra?.prompt, this.deps.message);
      if (extra?.prompt && !promptAlreadySeeded) {
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
      const renderer = this.deps.adapter.createRunRenderer(
        this.deps.replyTarget,
      );

      // Transcript auto-bridge (step 1 + 2): inject prior cross-platform history
      // as a context entry, then append the current user turn. This flag owns the
      // bridge — see `runAgent`'s `transcript` doc. No-ops with one warning when
      // identity/transcripts aren't configured.
      const transcripts = this.deps.transcripts;
      const userId = this.deps.user?.id;
      let transcriptContext: ContextEntry | undefined;
      if (extra?.transcript) {
        if (transcripts && userId) {
          const limit =
            typeof extra.transcript === "object"
              ? (extra.transcript.limit ?? 20)
              : 20;
          // List BEFORE appending the current user turn so the current message
          // isn't counted as its own "prior history".
          const prior = await transcripts.list({ userId, limit });
          if (prior.length > 0) {
            transcriptContext = {
              description: `Prior cross-platform conversation history with this user. Current channel: ${this.platform}.`,
              value: prior
                .map((e) => `[${e.platform}] ${e.role}: ${e.text}`)
                .join("\n"),
            };
          }
          if (this.deps.message) {
            await transcripts.append(this, this.deps.message, { userId });
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
        const loopArgs: RunLoopArgs = {
          agent: session.agent,
          renderer,
          tools,
          toolDescriptors,
          context,
          makeToolCtx: (): ChannelToolContext => ({
            thread: this,
            message: this.deps.message,
            user: this.deps.user,
            actor: this.deps.actor,
            signal:
              (
                session.agent as AbstractAgent & {
                  abortController?: AbortController;
                }
              ).abortController?.signal ?? new AbortController().signal,
            platform: this.platform,
          }),
          handleInterrupt: async (interrupt) => {
            // Retain BEFORE dispatching: the handler posts the picker, and the
            // click that resumes it can arrive at any later moment, so the value
            // has to already be durable by the time the button exists.
            await this.rememberInterruptEvent(interrupt.value);
            const h = this.deps.interruptHandlers.get(interrupt.eventName);
            if (h)
              await h({
                payload: interrupt.value,
                thread: this,
                user: this.deps.user,
                actor: this.deps.actor,
              });
          },
          initialResume,
        };
        loopResult = this.deps.adapter.runAgentLifecycle
          ? await this.deps.adapter.runAgentLifecycle({
              replyTarget: this.deps.replyTarget,
              agent: session.agent,
              renderer,
              tools: toolDescriptors,
              context,
              isResume: initialResume !== undefined,
              user: this.deps.user,
              memory: extra?.memory,
              execute: (subscriber, canonicalRun) =>
                runAgentLoop({
                  ...loopArgs,
                  subscriber,
                  ...(canonicalRun ? { canonicalRun } : {}),
                }),
            })
          : await runAgentLoop(loopArgs);
        stage = "finalize";
        // Transcript auto-bridge (step 4): capture the assistant text this run
        // produced and append it. Only when the bridge actually applied (transcripts
        // + userId both present and `transcript` was requested).
        if (extra?.transcript && transcripts && userId) {
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
              { userId },
            );
          }
        }

        // Turn-end hook: lets a renderer finalize any turn-scoped resource it kept
        // open across runAgent iterations (e.g. a native streaming message). A
        // no-op for renderers whose per-message streams already self-terminate, and
        // for runs that were interrupted (the renderer guards that internally).
        await renderer.finish?.();
      } catch (err) {
        // Best-effort finalize on failure so native Slack streams still get
        // stopStream after mid-run delivery/append errors (deferred deliveryError
        // or run-loop throw). finish is idempotent; original error wins.
        try {
          await renderer.finish?.();
        } catch {
          // Prefer the original failure over finalize noise.
        }
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
    } finally {
      await session.release?.();
    }
  }
}

function promptMatchesInbound(
  prompt: string | AgentContentPart[] | undefined,
  message: ThreadDeps["message"],
): boolean {
  if (prompt === undefined || message === undefined) return false;
  if (typeof prompt === "string") return prompt === message.text;
  return (
    message.contentParts !== undefined &&
    JSON.stringify(prompt) === JSON.stringify(message.contentParts)
  );
}

function containsType(nodes: readonly ChannelNode[], type: string): boolean {
  for (const node of nodes) {
    if (node.type === type) return true;
    const raw = node.props.children;
    const kids = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    const next: ChannelNode[] = [];
    for (const k of kids) {
      if (typeof k === "object" && k !== null && "type" in k) {
        next.push(k as ChannelNode);
      }
    }
    if (containsType(next, type)) return true;
  }
  return false;
}

let transcriptWarned = false;
/** Warn once when `runAgent({ transcript })` is used without identity/transcripts configured. */
function warnTranscriptIgnored(): void {
  if (transcriptWarned) return;
  transcriptWarned = true;
  console.warn(
    "[channel] runAgent({ transcript }) ignored — configure store.transcripts and identify the current application user",
  );
}

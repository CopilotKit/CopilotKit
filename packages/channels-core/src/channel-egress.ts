import type {
  ChannelNode,
  MessageRef,
  PlatformUser,
  EmojiValue,
  EphemeralResult,
  ThreadMessage,
} from "@copilotkit/channels-ui";
import type {
  PlatformAdapter,
  ReplyTarget,
  RunRenderer,
  UserQuery,
} from "./platform-adapter.js";

/**
 * A bounded, provider-agnostic description of one outbound provider effect
 * (plan §2 "durable provider effects"). The Channel's {@link ChannelEgress} port
 * turns these into the actual credentialed provider calls — in production the
 * Intelligence Connector Outbox, and CopilotKit-side a `ChannelRunner`-supplied
 * port (proven by `createTestChannelRunner()` and a custom-runner consumer).
 *
 * Render ops carry the rendered {@link ChannelNode} IR (`ir`), which is already
 * a bounded, serializable tree; the port renders IR → native at the credential
 * boundary. Effects never carry provider clients, credentials, tokens, URLs, or
 * HTTP requests.
 *
 * The two *live* provider operations — incremental `stream()` and the run-loop
 * {@link RunRenderer} — are explicit {@link ChannelEgress} methods rather than
 * discrete effects, because neither is a single bounded value.
 */
export type ProviderEffect =
  | {
      readonly op: "post";
      readonly target: ReplyTarget;
      readonly ir: ChannelNode[];
    }
  | {
      readonly op: "update";
      readonly ref: MessageRef;
      readonly ir: ChannelNode[];
    }
  | { readonly op: "delete"; readonly ref: MessageRef }
  | {
      readonly op: "react";
      readonly target: ReplyTarget;
      readonly ref: MessageRef;
      readonly emoji: EmojiValue;
      /** `true` adds the reaction, `false` removes it. */
      readonly add: boolean;
    }
  | {
      readonly op: "ephemeral";
      readonly target: ReplyTarget;
      readonly user: PlatformUser | string;
      readonly ir: ChannelNode[];
      readonly fallbackToDM: boolean;
    }
  | {
      readonly op: "file";
      readonly target: ReplyTarget;
      readonly file: {
        bytes: Uint8Array;
        filename: string;
        title?: string;
        altText?: string;
      };
    }
  | {
      readonly op: "suggested";
      readonly target: ReplyTarget;
      readonly prompts: ReadonlyArray<{ title: string; message: string }>;
      readonly title?: string;
    }
  | {
      readonly op: "title";
      readonly target: ReplyTarget;
      readonly title: string;
    };

/** The result of one {@link ProviderEffect}, mapped per-op via {@link EffectResultFor}. */
export type EffectResultFor<E extends ProviderEffect> = E extends {
  op: "post" | "update";
}
  ? MessageRef
  : E extends { op: "delete" }
    ? void
    : E extends { op: "ephemeral" }
      ? EphemeralResult | null
      : E extends { op: "file" }
        ? { ok: boolean; fileId?: string; error?: string }
        : E extends { op: "react" | "suggested" | "title" }
          ? { ok: boolean; error?: string }
          : never;

/**
 * The bound egress port a Channel emits provider effects through. Declarative
 * adapters render + normalize; the port owns the credentialed provider calls.
 *
 * {@link send} carries discrete bounded {@link ProviderEffect}s; {@link stream}
 * and {@link createRunRenderer} are the two live streaming operations. Reads
 * ({@link getMessages}, {@link lookupUser}) are capability-gated and may be
 * absent.
 */
export interface ChannelEgress {
  send<E extends ProviderEffect>(effect: E): Promise<EffectResultFor<E>>;
  /** Post an incrementally-streamed message; returns the final message ref. */
  stream(
    target: ReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef>;
  /** A per-run renderer the run loop streams AG-UI events into (plan §2: port-owned). */
  createRunRenderer(target: ReplyTarget): RunRenderer;
  /** Read conversation history (absent when the surface can't read history). */
  getMessages?(target: ReplyTarget): Promise<ThreadMessage[]>;
  /** Resolve a platform user (absent when the surface can't look users up). */
  lookupUser?(q: UserQuery): Promise<PlatformUser | undefined>;
}

/**
 * The transitional egress port used while adapters still own their transport:
 * it delegates every effect straight to the wrapped {@link PlatformAdapter}'s
 * existing methods, so behavior is identical to the pre-port path. Each adapter
 * is later gutted so its transport moves behind a real (Intelligence / custom)
 * runner port, and this wrapper falls away.
 *
 * Capability-gated effects mirror the adapter's optional methods: when the
 * underlying method is absent, `send` resolves to the same `{ ok: false }`
 * shape (and identical message) the Thread returned before the port existed.
 */
export class DirectAdapterEgress implements ChannelEgress {
  constructor(private readonly adapter: PlatformAdapter) {}

  private get platform(): string {
    return this.adapter.platform;
  }

  async send<E extends ProviderEffect>(effect: E): Promise<EffectResultFor<E>> {
    const a = this.adapter;
    switch (effect.op) {
      case "post":
        return (await a.post(effect.target, effect.ir)) as EffectResultFor<E>;
      case "update":
        await a.update(effect.ref, effect.ir);
        return effect.ref as EffectResultFor<E>;
      case "delete":
        await a.delete(effect.ref);
        return undefined as EffectResultFor<E>;
      case "react":
        return (await this.react(effect)) as EffectResultFor<E>;
      case "ephemeral":
        return (await this.ephemeral(effect)) as EffectResultFor<E>;
      case "file":
        return (await this.file(effect)) as EffectResultFor<E>;
      case "suggested":
        return (await this.suggested(effect)) as EffectResultFor<E>;
      case "title":
        return (await this.title(effect)) as EffectResultFor<E>;
    }
  }

  private async react(
    e: Extract<ProviderEffect, { op: "react" }>,
  ): Promise<{ ok: boolean; error?: string }> {
    const a = this.adapter;
    const fn = e.add ? a.addReaction : a.removeReaction;
    if (!fn) {
      return {
        ok: false,
        error: `${this.platform} does not support reactions`,
      };
    }
    return fn.call(a, e.target, e.ref, e.emoji);
  }

  private async ephemeral(
    e: Extract<ProviderEffect, { op: "ephemeral" }>,
  ): Promise<EphemeralResult | null> {
    const a = this.adapter;
    if (!a.postEphemeral) {
      return {
        ok: false,
        error: `${this.platform} does not support ephemeral messages`,
      };
    }
    return a.postEphemeral(e.target, e.user, e.ir, {
      fallbackToDM: e.fallbackToDM,
    });
  }

  private async file(
    e: Extract<ProviderEffect, { op: "file" }>,
  ): Promise<{ ok: boolean; fileId?: string; error?: string }> {
    const a = this.adapter;
    if (!a.postFile) {
      return {
        ok: false,
        error: `${this.platform} does not support file upload`,
      };
    }
    return a.postFile(e.target, e.file);
  }

  private async suggested(
    e: Extract<ProviderEffect, { op: "suggested" }>,
  ): Promise<{ ok: boolean; error?: string }> {
    const a = this.adapter;
    if (!a.setSuggestedPrompts) {
      return {
        ok: false,
        error: `${this.platform} does not support suggested prompts`,
      };
    }
    return a.setSuggestedPrompts(
      e.target,
      e.prompts,
      e.title !== undefined ? { title: e.title } : undefined,
    );
  }

  private async title(
    e: Extract<ProviderEffect, { op: "title" }>,
  ): Promise<{ ok: boolean; error?: string }> {
    const a = this.adapter;
    if (!a.setThreadTitle) {
      return {
        ok: false,
        error: `${this.platform} does not support thread titles`,
      };
    }
    return a.setThreadTitle(e.target, e.title);
  }

  stream(
    target: ReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    return this.adapter.stream(target, chunks);
  }

  createRunRenderer(target: ReplyTarget): RunRenderer {
    return this.adapter.createRunRenderer(target);
  }

  getMessages(target: ReplyTarget): Promise<ThreadMessage[]> {
    return this.adapter.getMessages?.(target) ?? Promise.resolve([]);
  }

  lookupUser(q: UserQuery): Promise<PlatformUser | undefined> {
    return this.adapter.lookupUser?.(q) ?? Promise.resolve(undefined);
  }
}

// TODO(OSS-377): replace this module with the shared
// `@copilotkit/managed-bot-contracts` package once it lands. This is a minimal,
// self-owned placeholder: ONLY the fields the bridge adapter actually reads or
// writes are typed. The rest of the OSS-377 surface — Zod schemas, the full
// event-kind set, bounded failure codes, health/read models — is intentionally
// left out and noted inline so the swap later is a pure import change.

import type { BotNode, MessageRef } from "@copilotkit/channels-ui";

/**
 * Opaque return address minted by Intelligence and echoed back on egress. The
 * SDK never interprets it — it only carries it from ingress to the egress sink.
 */
export type EgressRoute = unknown;

/** Fields common to every managed ingress envelope. */
export interface ManagedIngressBase {
  /** Unique per delivery attempt (lease). At-least-once: may be redelivered. */
  deliveryId: string;
  /** Stable platform event id (idempotency / dedup). */
  eventId: string;
  /** Stable per-logical-turn id. Egress operation ids derive from it. */
  turnId: string;
  /** Project-unique bot identifier (matches `createBot({ name })`). */
  botName: string;
  /** Originating platform (e.g. "slack"). Stamped onto the handler-facing message. */
  platform: string;
  conversationKey: string;
  user?: { id: string; displayName?: string };
  /** Opaque egress route the sink needs to address the reply. No creds. */
  route: EgressRoute;
}

/**
 * One unit of leased work Intelligence delivers to the runtime. Discriminated
 * on `kind`; the bridge adapter routes each to the matching bot-core sink call.
 *
 * TODO(OSS-377): the frozen envelope will carry richer per-kind payloads
 * (contentParts, structured command options, raw interaction values, etc.).
 */
/**
 * A turn-input file reference: an opaque handle plus display metadata (no
 * bytes). The adapter fetches the bytes lazily via
 * {@link DeliverySource.fetchFile} and builds `AgentContentPart`s from them.
 */
export interface ManagedFileRef {
  handle: string;
  filename: string;
  mimeType?: string;
  byteSize?: number;
}

export type ManagedIngressEnvelope =
  | (ManagedIngressBase & {
      kind: "turn";
      text?: string;
      /** Inbound files attached to this turn (images, docs, …), in order. */
      files?: ManagedFileRef[];
    })
  | (ManagedIngressBase & {
      kind: "command";
      /** Command name as invoked (leading slash / case normalized by core). */
      command: string;
      /** Raw argument string after the command name. */
      text?: string;
      /** Opaque platform trigger for opening a modal. */
      triggerId?: string;
      /** Structured, pre-parsed options when the surface delivers them. */
      rawOptions?: Record<string, unknown>;
    })
  | (ManagedIngressBase & {
      kind: "interaction";
      /** Minted action id (ck:...) the rendered control carries. */
      actionId: string;
      value?: unknown;
      /** The message the interaction occurred on (so handlers can update it). */
      messageRef?: MessageRef;
      triggerId?: string;
    })
  | (ManagedIngressBase & { kind: "thread_started" })
  | (ManagedIngressBase & {
      kind: "reaction";
      /** Platform-native emoji token. */
      rawEmoji: string;
      /** true = added, false = removed. */
      added: boolean;
      messageId: string;
      threadId?: string;
      /**
       * The SDK post-time message ref the reacted provider message maps to,
       * when Intelligence could reverse-resolve it (the reaction itself only
       * carries the provider ts). Lets the bot resolve a `<Message onReaction>`
       * handler persisted under that ref.
       */
      postedRef?: string;
    });

/** A generic, platform-agnostic reply operation emitted by the bridge adapter. */
export type EgressOp =
  | { kind: "post"; ir: BotNode[] }
  | { kind: "update"; ref: string; ir: BotNode[] }
  | { kind: "delete"; ref: string };
// TODO(OSS-377): a "stream" op for incremental updates, once the streaming
// capability is honored end-to-end.

export interface EgressOperation {
  /** Deterministic: derived from (turnId, per-turn sequence) so redelivery of
   * the same turn reproduces the same ids and the Outbox can dedupe. */
  operationId: string;
  turnId: string;
  deliveryId: string;
  route: EgressRoute;
  op: EgressOp;
}

export type EgressResult =
  | { ok: true; ref: string }
  // TODO(OSS-377): `code` becomes a bounded failure-code enum.
  | { ok: false; code: string };

// ── Realtime render events (OSS-402) ──────────────────────────────────────
// Mirrors the frozen `hosted_bot.render_event.v1` contract on the Intelligence
// side (libs/app-api-contracts/src/hosted-bots.ts). The SDK streams these
// semantic frames to the realtime-gateway; the gateway-side Connector Outbox
// (OSS-404) renders them to the provider (Slack Block Kit, etc.).
// TODO(OSS-377): replace with the shared `@copilotkit/managed-bot-contracts`
// package; `post`/`update` content is `BotNode[]` (SDK IR) here — the frozen
// contract types it as opaque `HostedBotRenderContent`.

/** One semantic render frame the agent run emits. Matches the frozen kinds. */
export type HostedBotRenderEvent =
  | { kind: "run_started" }
  | { kind: "text_delta"; messageId: string; delta: string }
  | { kind: "text_end"; messageId: string }
  | { kind: "tool_start"; toolCallId: string; toolName: string }
  | { kind: "tool_end"; toolCallId: string; toolName: string }
  | { kind: "interrupt" }
  | { kind: "run_error"; message: string }
  | { kind: "post"; content: BotNode[] }
  | { kind: "update"; ref: string; content: BotNode[] }
  | {
      /**
       * Outbound file post (`thread.postFile`). Bytes were streamed to app-api
       * ahead of this frame and stored in object storage under `handle`; the
       * Connector Outbox fetches them and calls Slack `files.uploadV2`.
       */
      kind: "file";
      handle: string;
      filename: string;
      title?: string;
      altText?: string;
    }
  | { kind: "finalize" };

/** All render-event kinds, for exhaustive/ordering checks. */
export type HostedBotRenderEventKind = HostedBotRenderEvent["kind"];

/**
 * The adapter-facing render frame. The {@link RenderEventSink} fills in the
 * org/project/bot scope, the `idempotencyKey` (`turnId:slot:seq`), the
 * `runtimeInstanceId`, and `sentAt` before it hits the wire — the adapter only
 * supplies the delivery/turn identity, the render lane (`slot`), the monotonic
 * per-`(turn, slot)` `seq`, and the semantic `event`.
 */
export interface RenderFrame {
  deliveryId: string;
  turnId: string;
  /** Render lane; a single turn uses `"main"` for V1. */
  slot: string;
  /** Zero-based, monotonic within `(turnId, slot)`. */
  seq: number;
  event: HostedBotRenderEvent;
}

/** Durable-acceptance receipt echoed back for each pushed {@link RenderFrame}. */
export interface RenderAccepted {
  /** `${turnId}:${slot}:${seq}` — the frame's idempotency key. */
  idempotencyKey: string;
  /**
   * `accepted` — first durable write; `duplicate_accepted` — same
   * (idempotency-key, payload) re-pushed (benign, at-least-once retry). A
   * payload MISMATCH for an existing key is a 409 conflict on the transport, not
   * an acceptance value, and surfaces as a thrown render error (turn nack).
   */
  acceptance: "accepted" | "duplicate_accepted";
  /** Present only on an accepted `finalize` frame — links to the egress op. */
  egressOperationId?: string;
}

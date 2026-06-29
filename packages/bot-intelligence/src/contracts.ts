// TODO(OSS-377): replace this module with the shared
// `@copilotkit/managed-bot-contracts` package once it lands. This is a minimal,
// self-owned placeholder: ONLY the fields the bridge adapter actually reads or
// writes are typed. The rest of the OSS-377 surface — Zod schemas, the full
// event-kind set, bounded failure codes, health/read models — is intentionally
// left out and noted inline so the swap later is a pure import change.

import type { BotNode, MessageRef } from "@copilotkit/bot-ui";

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
export type ManagedIngressEnvelope =
  | (ManagedIngressBase & { kind: "turn"; text?: string })
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

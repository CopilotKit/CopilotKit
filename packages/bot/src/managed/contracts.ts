// TODO(OSS-377): replace this module with the shared
// `@copilotkit/managed-bot-contracts` package once it lands. This is a minimal,
// self-owned placeholder: ONLY the fields the bridge adapter actually reads or
// writes are typed. The rest of the OSS-377 surface — Zod schemas, the full
// event-kind set, bounded failure codes, health/read models — is intentionally
// left out and noted inline so the swap later is a pure import change.

import type { BotNode } from "@copilotkit/bot-ui";

/**
 * Opaque return address minted by Intelligence and echoed back on egress. The
 * SDK never interprets it — it only carries it from ingress to the egress sink.
 */
export type EgressRoute = unknown;

/**
 * One unit of leased work Intelligence delivers to the runtime.
 *
 * TODO(OSS-377): the frozen envelope will also carry `contentParts`, richer
 * `user` fields, and additional `kind`s ("command" | "interaction" |
 * "thread_started" | "reaction"). For the first slice only "turn" is handled.
 */
export interface ManagedIngressEnvelope {
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
  /** First slice handles "turn" only. TODO(OSS-377): widen. */
  kind: "turn";
  text?: string;
  user?: { id: string; displayName?: string };
  /** Opaque egress route the sink needs to address the reply. No creds. */
  route: EgressRoute;
}

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

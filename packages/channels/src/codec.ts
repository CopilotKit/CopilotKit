import type { BotNode } from "@copilotkit/channels-ui";

/**
 * A pure, dependency-free, per-platform codec shared by the local adapter and
 * the Intelligence side. It exists so platform *semantics* (how to render IR to
 * a native payload, and — later — how to normalize a native event to the
 * neutral ingress shape) live in ONE place, instead of being duplicated between
 * a credentialed local adapter (Bolt/discord.js) and the Connector Outbox /
 * webhook ingress.
 *
 * Only the two creds/connection-bound concerns stay per-side: the transport
 * (who holds the platform connection) and the credentialed send. The codec
 * excludes both — `renderEgress` is pure (IR → native payload); the actual
 * send happens in the Connector Outbox with Intelligence-owned credentials.
 *
 * TODO(OSS-363): add `normalizeIngress(raw): NeutralEvent` once the pure Slack
 * ingress mapping (mention stripping, stable event-id derivation, real-user
 * filtering, field extraction) is extracted from the Bolt listener so both the
 * local adapter and Intelligence's webhook ingress consume the same logic.
 */
export interface PlatformCodec {
  readonly platform: string;
  /** IR → native payload. Pure; opaque to bot core. */
  renderEgress(ir: BotNode[]): unknown;
}

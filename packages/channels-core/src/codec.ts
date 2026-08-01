import type { ChannelNode } from "@copilotkit/channels-ui";

/**
 * A pure, dependency-free, per-platform codec shared by the local adapter and
 * the Intelligence side. It exists so platform *semantics* (how to render IR to
 * a native payload, and — later — how to normalize a native event to the
 * neutral ingress shape) live in ONE place, instead of being duplicated between
 * a credentialed local adapter and Gateway-owned provider delivery.
 *
 * Only the two creds/connection-bound concerns stay per-side: the transport
 * (who holds the platform connection) and the credentialed send. The codec
 * excludes both — `renderEgress` is pure (IR → native payload); the actual
 * send happens in the Gateway with Intelligence-owned credentials.
 *
 * TODO (untracked): add `normalizeIngress(raw): NeutralEvent` so both the local
 * adapter and Intelligence's webhook ingress consume the same logic. The stated
 * precondition is already met — the pure Slack ingress mapping (mention stripping,
 * stable event-id derivation, real-user filtering, field extraction) now lives in
 * `channels-slack/src/ingress-normalize.ts`. The original tracking ticket (OSS-363)
 * was canceled 2026-07-01, superseded by OSS-401 — re-file before acting.
 */
export interface PlatformCodec {
  readonly platform: string;
  /** IR → native payload. Pure; opaque to channel core. */
  renderEgress(ir: ChannelNode[]): unknown;
}

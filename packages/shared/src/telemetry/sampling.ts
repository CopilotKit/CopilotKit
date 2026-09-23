// Per-event telemetry metadata shared by both TelemetryClients.
//
// Two clients emit `oss.runtime.*`: the v1 client in this package and the
// v2 client in @copilotkit/runtime. Neither samples the lambda sink any
// more — that sink is ours, so anonymous volume costs us nothing per
// event and full fidelity beats an extrapolation. One wire is still
// gated: the Segment copy the v1 client sends, which is billed per event.
//
// Every event therefore still carries a sampling block, because the two
// populations remain distinguishable and a Segment-sourced count still
// needs sum(sampleWeight) to mean anything. On the lambda wire the block
// reads sampleRate=1/sampleWeight=1, which is the honest answer rather
// than a placeholder.
//
// The two clients computed this independently and drifted: v2 sampled but
// stamped nothing, leaving ~24% of runtime volume unweightable from the
// data alone (OSS-1017). Computing it here is what stops them drifting
// again.

/** The rate a sink that takes every event is "gated" at. */
export const UNSAMPLED_RATE = 1;

/** Identifies which client emitted an event. */
export const TELEMETRY_EMITTER_V1 = "v1-shared";
export const TELEMETRY_EMITTER_V2 = "v2-runtime";

export type TelemetryEmitter =
  | typeof TELEMETRY_EMITTER_V1
  | typeof TELEMETRY_EMITTER_V2;

/**
 * Which public API surface the developer built against.
 *
 * Separate from {@link TelemetryEmitter} on purpose. The emitter names a
 * client library, and there are six of them across four languages; the
 * surface answers the question anyone actually asks of this data, which
 * is how much traffic still arrives through the deprecated v1 API. The
 * native runtimes (Go, Python, Ruby, .NET) expose v2 only, so they report
 * `v2` without having a v1 notion of their own.
 */
// `as const` so the values keep their literal types when they land in a
// mutable object property, which is how the v1 shim passes the surface
// into the V2 runtime's options.
export const TELEMETRY_SURFACE_V1 = "v1" as const;
export const TELEMETRY_SURFACE_V2 = "v2" as const;

export type TelemetrySurface =
  | typeof TELEMETRY_SURFACE_V1
  | typeof TELEMETRY_SURFACE_V2;

/**
 * Which wire an event copy travelled on. The v1 client sends each capture
 * to both, so this is what tells the two copies apart downstream
 * (OSS-1019); the v2 client only ever sends to the lambda sink.
 */
export type TelemetryTransport = "segment" | "lambda";

export interface SamplingMeta {
  /** The rate this event was actually gated at: 1 when unsampled or identified. */
  sampleRate: number;
  sampleRateAdjustmentFactor: number;
  /** Multiply by this to extrapolate the population the event stands for. */
  sampleWeight: number;
  /** Whether the event bypassed the sample gate. */
  telemetry_identified: boolean;
}

/**
 * Compute the sampling block for one captured event.
 *
 * `telemetryId` is the caller's parsed license telemetry_id, or null when
 * anonymous — it decides the branch, and is deliberately not returned:
 * only the non-PII shape below travels on the event.
 *
 * `sampleRate` is the rate of the wire this copy travels on, so an
 * unsampled sink passes {@link UNSAMPLED_RATE}. Call it once per wire:
 * the v1 client sends one capture to two wires gated differently, and a
 * shared block would misweight one of them.
 */
export function computeSamplingMeta({
  telemetryId,
  sampleRate,
}: {
  telemetryId: string | null;
  sampleRate: number;
}): SamplingMeta {
  const identified = Boolean(telemetryId);
  // Identified events ship at a 100% effective rate, anonymous ones at
  // sampleRate. Computed per event because a single global weight would
  // overweight identified-customer counts by 1/sampleRate.
  const effectiveSampleRate = identified ? 1 : sampleRate;

  return {
    sampleRate: effectiveSampleRate,
    sampleRateAdjustmentFactor: 1 - effectiveSampleRate,
    sampleWeight: 1 / effectiveSampleRate,
    // Stated outright rather than inferred from sampleWeight === 1:
    // under COPILOTKIT_TELEMETRY_SAMPLE_RATE=1 anonymous events also
    // weigh 1, and the two populations stop being distinguishable
    // (OSS-1018).
    telemetry_identified: identified,
  };
}

// Per-event telemetry metadata shared by both TelemetryClients.
//
// Two clients emit `oss.runtime.*`: the v1 client in this package and the
// v2 client in @copilotkit/runtime. Both gate anonymous events at
// `sampleRate` and let identified callers (a license token that yielded a
// telemetry_id) through at 100%, so real volume can only be recovered
// downstream as sum(sampleWeight) — a flat multiplier is wrong whenever
// the identified share moves, which it does as Intelligence keys roll out.
//
// The two clients computed this independently and drifted: v2 sampled but
// stamped nothing, leaving ~24% of runtime volume unweightable from the
// data alone (OSS-1017). Computing it here is what stops them drifting
// again.

/** Identifies which client emitted an event. */
export const TELEMETRY_EMITTER_V1 = "v1-shared";
export const TELEMETRY_EMITTER_V2 = "v2-runtime";

export type TelemetryEmitter =
  | typeof TELEMETRY_EMITTER_V1
  | typeof TELEMETRY_EMITTER_V2;

/**
 * Which wire an event copy travelled on. The v1 client sends each capture
 * to both, so this is what tells the two copies apart downstream
 * (OSS-1019); the v2 client only ever sends to the lambda sink.
 */
export type TelemetryTransport = "segment" | "lambda";

export interface SamplingMeta {
  /** The rate this event was actually gated at: 1 when identified. */
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

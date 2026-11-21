// Per-event telemetry metadata shared by both TelemetryClients.
//
// Two clients emit `oss.runtime.*`: the v1 client in this package and the
// v2 client in @copilotkit/runtime. Owning the lambda sink they send to
// does not make the events it fans out free. In Nov 2026 one deployment
// sent 15.2M `oss.runtime.copilot_request_created` events a week — 48% of
// the whole PostHog project, and 99% of it `requestType: "connect"` — and
// we were billed for it downstream.
//
// A connect is not a request in the sense that a run is. The client sends
// one each time a chat mounts, to replay the thread it is opening, so an
// app that mounts its chat often (a sidebar, a modal, tabs, routes) sends
// many of them while working perfectly. The replay itself has to happen —
// on the plain runtime it is the only way a remounted chat picks up what
// another tab added — so the network call stays. Only its accounting
// changes: each client keeps {@link CONNECT_SAMPLE_RATE} of anonymous
// connect events at the source and drops the rest, before any wire. Runs
// are never sampled here: they are the denominator of the connect:run
// ratio, and thinning both sides would make that ratio an estimate of an
// estimate.
//
// Other gates compose with this one by multiplication, never by
// replacement: the v2 client's COPILOTKIT_TELEMETRY_SAMPLE_RATE opt-down,
// and the v1 client's gate on the Segment copy it sends, which is billed
// per event. An anonymous connect that reaches Segment was kept at
// CONNECT_SAMPLE_RATE x the Segment rate, and the block on that copy says
// so. Anything further downstream that samples again must likewise
// multiply its rate into the one stamped here.
//
// Every event therefore carries a sampling block, because the populations
// remain distinguishable and any sampled count needs sum(sampleWeight) to
// mean anything. An event no gate touched reads sampleRate=1 and
// sampleWeight=1, which is the honest answer rather than a placeholder.
//
// The two clients computed this independently and drifted: v2 sampled but
// stamped nothing, leaving ~24% of runtime volume unweightable from the
// data alone (OSS-1017). Computing it here is what stops them drifting
// again.

/** The rate a sink that takes every event is "gated" at. */
export const UNSAMPLED_RATE = 1;

/**
 * Fraction of anonymous `requestType: "connect"` request events kept at the
 * source. Identified callers are exempt, as they are from every other gate.
 */
export const CONNECT_SAMPLE_RATE = 0.05;

const REQUEST_CREATED_EVENT = "oss.runtime.copilot_request_created";

/**
 * The rate one event is gated at before any wire sees it, for an anonymous
 * caller: {@link CONNECT_SAMPLE_RATE} for a connect request, and
 * {@link UNSAMPLED_RATE} for everything else, runs included.
 *
 * The caller multiplies this into its own rate, keeps the event with that
 * probability, and passes the product to {@link computeSamplingMeta}, which
 * also lifts identified callers back to 1. Both clients ask here so the
 * policy lives in one place.
 */
export function sourceSampleRate(event: string, properties: unknown): number {
  if (event !== REQUEST_CREATED_EVENT) return UNSAMPLED_RATE;
  if (
    typeof properties === "object" &&
    properties !== null &&
    "requestType" in properties &&
    properties.requestType === "connect"
  ) {
    return CONNECT_SAMPLE_RATE;
  }
  return UNSAMPLED_RATE;
}

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

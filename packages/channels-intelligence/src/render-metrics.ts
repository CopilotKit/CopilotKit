/**
 * Render-frame push instrumentation (OSS-648).
 *
 * Channel egress pushes render frames to Intelligence and awaits each durable
 * acceptance receipt before sending the next. Until frames were coalesced that
 * meant one round trip per AG-UI token, so reply latency scaled with token count
 * rather than with reply size — and none of it showed up in logs, because
 * nothing recorded how many frames a turn sent, how long each push blocked, or
 * what share of the turn went to waiting on receipts.
 *
 * This module measures that at the single point every frame passes through (the
 * run renderer's push pump), so one seam covers both the HTTP render-accept
 * transport and the realtime-gateway transport. It is off unless
 * `COPILOTKIT_CHANNELS_RENDER_METRICS` is set, and when off no collector is
 * built at all.
 *
 * Three numbers judge a change to the egress path:
 *
 * - `deltasPerTextFrame` — AG-UI deltas folded into each pushed frame. 1 means
 *   one round trip per token.
 * - `charsPerTextFrame` — how much text each round trip carries.
 * - `pushBlockedPct` — how much of the turn was spent waiting on receipts.
 */

/** Verbosity for render-frame push instrumentation. */
export type RenderMetricsMode = "off" | "summary" | "frames";

/** Env var that turns instrumentation on. */
const ENV_VAR = "COPILOTKIT_CHANNELS_RENDER_METRICS";

/**
 * Read the instrumentation mode from an environment bag.
 *
 * Unset, empty, `0`, `false`, `off`, and anything unrecognized all mean "off",
 * so a typo degrades to silence rather than to unexpected log volume on a hot
 * path.
 *
 * @param env - Environment bag to read `COPILOTKIT_CHANNELS_RENDER_METRICS` from.
 * @returns The resolved mode.
 */
export function resolveRenderMetricsMode(
  env: Record<string, string | undefined>,
): RenderMetricsMode {
  const raw = env[ENV_VAR]?.trim().toLowerCase();
  if (!raw || raw === "0" || raw === "false" || raw === "off") return "off";
  if (raw === "frames") return "frames";
  if (raw === "1" || raw === "true" || raw === "summary") return "summary";
  return "off";
}

/** One turn's push-latency profile. */
export interface RenderTurnMetricsSummary {
  readonly turnId: string;
  readonly deliveryId: string;
  /** Total frames pushed this turn. */
  readonly frames: number;
  /** Frame count keyed by render-event kind. */
  readonly framesByKind: Record<string, number>;
  /** `text_delta` frames actually pushed — the count coalescing reduces. */
  readonly textDeltaFrames: number;
  /**
   * AG-UI text deltas those frames represent. Equals `textDeltaFrames` when
   * nothing merged, and exceeds it once coalescing is doing work.
   */
  readonly textDeltaEvents: number;
  /** Total characters carried by those `text_delta` frames. */
  readonly textDeltaChars: number;
  /**
   * Mean AG-UI deltas folded into each pushed frame, or null when the turn sent
   * none. 1 means one round trip per token.
   */
  readonly deltasPerTextFrame: number | null;
  /**
   * Mean characters per pushed `text_delta` frame, or null when the turn sent
   * none. One round trip per token shows up here as a single-digit value.
   */
  readonly charsPerTextFrame: number | null;
  /** Wall-clock ms spent blocked awaiting acceptance receipts. */
  readonly pushMsTotal: number;
  readonly pushMsMean: number;
  readonly pushMsP50: number;
  readonly pushMsP95: number;
  readonly pushMsMax: number;
  /** Wall-clock ms from collector creation to {@link RenderTurnMetrics.finish}. */
  readonly turnWallMs: number;
  /**
   * `pushMsTotal` as a percentage of `turnWallMs`. A high value means the turn
   * is round-trip bound, which is the claim this instrumentation exists to test.
   */
  readonly pushBlockedPct: number;
}

/** Collects push latencies for one turn and logs a summary when it ends. */
export interface RenderTurnMetrics {
  /**
   * Record one completed frame push.
   *
   * @param kind - Render-event kind (`text_delta`, `finalize`, …).
   * @param startedAt - Clock reading taken before the push.
   * @param endedAt - Clock reading taken after the receipt was awaited.
   * @param deltaChars - Characters carried, for `text_delta` frames (else 0).
   * @param sourceEvents - Enqueued events this frame represents (1 unmerged).
   */
  recordPush(
    kind: string,
    startedAt: number,
    endedAt: number,
    deltaChars: number,
    sourceEvents?: number,
  ): void;
  /**
   * Close the turn, log the summary once, and return it. Safe to call more than
   * once (`finish` and `markInterrupted` both drain the chain); later calls
   * return the same summary without logging again.
   */
  finish(): RenderTurnMetricsSummary;
}

/** Inputs for {@link createRenderTurnMetrics}. */
export interface CreateRenderTurnMetricsOptions {
  readonly mode: RenderMetricsMode;
  readonly turnId: string;
  readonly deliveryId: string;
  /** Diagnostics sink, matching the transports' `log` seam. */
  readonly log: (message: string, meta?: unknown) => void;
  /** Clock override for tests. Defaults to {@link Date.now}. */
  readonly now?: () => number;
}

/** Nearest-rank percentile over an ascending-sorted list. */
const percentile = (sorted: readonly number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[index] ?? 0;
};

/** Round to two decimals so log lines stay readable. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Build a per-turn metrics collector, or `undefined` when instrumentation is
 * off so callers skip the work entirely.
 *
 * @param opts - Mode, turn identity, log sink, and optional clock.
 * @returns A collector, or undefined when `mode` is `"off"`.
 */
export function createRenderTurnMetrics(
  opts: CreateRenderTurnMetricsOptions,
): RenderTurnMetrics | undefined {
  if (opts.mode === "off") return undefined;

  const now = opts.now ?? Date.now;
  const startedAt = now();
  const latencies: number[] = [];
  const framesByKind: Record<string, number> = {};
  let textDeltaFrames = 0;
  let textDeltaEvents = 0;
  let textDeltaChars = 0;
  let summary: RenderTurnMetricsSummary | undefined;

  return {
    recordPush(kind, pushStartedAt, endedAt, deltaChars, sourceEvents = 1) {
      const pushMs = Math.max(0, endedAt - pushStartedAt);
      const pushIndex = latencies.length;
      latencies.push(pushMs);
      framesByKind[kind] = (framesByKind[kind] ?? 0) + 1;
      if (kind === "text_delta") {
        textDeltaFrames += 1;
        textDeltaEvents += sourceEvents;
        textDeltaChars += deltaChars;
      }
      if (opts.mode === "frames") {
        opts.log("channel render frame pushed", {
          turnId: opts.turnId,
          deliveryId: opts.deliveryId,
          pushIndex,
          kind,
          pushMs: round2(pushMs),
          ...(kind === "text_delta" ? { deltaChars, sourceEvents } : {}),
        });
      }
    },

    finish() {
      if (summary) return summary;
      const turnWallMs = Math.max(0, now() - startedAt);
      const pushMsTotal = latencies.reduce((sum, ms) => sum + ms, 0);
      const sorted = [...latencies].sort((a, b) => a - b);
      summary = {
        turnId: opts.turnId,
        deliveryId: opts.deliveryId,
        frames: latencies.length,
        framesByKind,
        textDeltaFrames,
        textDeltaEvents,
        textDeltaChars,
        deltasPerTextFrame:
          textDeltaFrames === 0
            ? null
            : round2(textDeltaEvents / textDeltaFrames),
        charsPerTextFrame:
          textDeltaFrames === 0
            ? null
            : round2(textDeltaChars / textDeltaFrames),
        pushMsTotal: round2(pushMsTotal),
        pushMsMean:
          latencies.length === 0 ? 0 : round2(pushMsTotal / latencies.length),
        pushMsP50: round2(percentile(sorted, 50)),
        pushMsP95: round2(percentile(sorted, 95)),
        pushMsMax: round2(sorted[sorted.length - 1] ?? 0),
        turnWallMs: round2(turnWallMs),
        pushBlockedPct:
          turnWallMs === 0 ? 0 : round2((pushMsTotal / turnWallMs) * 100),
      };
      opts.log("channel render metrics", summary);
      return summary;
    },
  };
}

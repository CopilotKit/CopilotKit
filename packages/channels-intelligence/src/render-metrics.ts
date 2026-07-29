/**
 * Render-frame push instrumentation (OSS-648).
 *
 * Channel egress pushes one render frame per AG-UI event and awaits its durable
 * acceptance receipt before sending the next, so a streaming reply costs one
 * round trip per token. That makes reply latency scale with token count rather
 * than with reply size, which is invisible in logs today: nothing records how
 * many frames a turn sent, how long each push blocked, or what share of the turn
 * was spent waiting on receipts.
 *
 * This module measures exactly that at the single point every frame passes
 * through (the run renderer's serial push chain), so one seam covers both the
 * HTTP render-accept transport and the realtime-gateway transport. It is off
 * unless `COPILOTKIT_CHANNELS_RENDER_METRICS` is set, and when off no collector
 * is built at all.
 *
 * The two numbers that matter for judging a batching change are
 * `charsPerTextFrame` (how much text each round trip carries) and
 * `pushBlockedPct` (how much of the turn was spent waiting).
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

/** One turn's batch-request latency and frame-volume profile. */
export interface RenderTurnMetricsSummary {
  readonly turnId: string;
  readonly deliveryId: string;
  /** Durable batch requests completed this turn. */
  readonly batches: number;
  /** Total frames pushed this turn. */
  readonly frames: number;
  /** Frame count keyed by render-event kind. */
  readonly framesByKind: Record<string, number>;
  /** `text_delta` frames only — the count batching should reduce. */
  readonly textDeltaFrames: number;
  /** Total characters carried by those `text_delta` frames. */
  readonly textDeltaChars: number;
  /**
   * Mean characters per `text_delta` frame, or null when the turn sent none.
   * One round trip per token shows up here as a single-digit value.
   */
  readonly charsPerTextFrame: number | null;
  /** Sum of completed batch request latency in ms. */
  readonly pushMsTotal: number;
  readonly pushMsMean: number;
  readonly pushMsP50: number;
  readonly pushMsP95: number;
  readonly pushMsMax: number;
  /** Wall-clock ms from collector creation to {@link RenderTurnMetrics.finish}. */
  readonly turnWallMs: number;
  /**
   * `pushMsTotal` as a percentage of `turnWallMs`. Batches are serialized per
   * lane, so this estimates the turn's acceptance round-trip share.
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
   */
  recordPush(
    kind: string,
    startedAt: number,
    endedAt: number,
    deltaChars: number,
  ): void;
  /**
   * Record one completed batch request without multiplying its latency by the
   * number of frames it carried.
   *
   * @param frames - Frame kinds and text sizes carried by the batch.
   * @param startedAt - Clock reading taken before the batch request.
   * @param endedAt - Clock reading taken after the receipt was awaited.
   */
  recordBatch(
    frames: ReadonlyArray<{ kind: string; deltaChars: number }>,
    startedAt: number,
    endedAt: number,
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
  let frames = 0;
  let textDeltaFrames = 0;
  let textDeltaChars = 0;
  let summary: RenderTurnMetricsSummary | undefined;

  const recordFrames = (
    batchFrames: ReadonlyArray<{ kind: string; deltaChars: number }>,
  ): void => {
    for (const frame of batchFrames) {
      frames += 1;
      framesByKind[frame.kind] = (framesByKind[frame.kind] ?? 0) + 1;
      if (frame.kind === "text_delta") {
        textDeltaFrames += 1;
        textDeltaChars += frame.deltaChars;
      }
    }
  };

  const recordLatency = (pushStartedAt: number, endedAt: number): number => {
    const pushMs = Math.max(0, endedAt - pushStartedAt);
    latencies.push(pushMs);
    return pushMs;
  };

  return {
    recordPush(kind, pushStartedAt, endedAt, deltaChars) {
      const seq = frames;
      const pushMs = recordLatency(pushStartedAt, endedAt);
      recordFrames([{ kind, deltaChars }]);
      if (opts.mode === "frames") {
        opts.log("channel render frame pushed", {
          turnId: opts.turnId,
          deliveryId: opts.deliveryId,
          seq,
          kind,
          pushMs: round2(pushMs),
          ...(kind === "text_delta" ? { deltaChars } : {}),
        });
      }
    },

    recordBatch(batchFrames, pushStartedAt, endedAt) {
      const batchSeq = latencies.length;
      const pushMs = recordLatency(pushStartedAt, endedAt);
      recordFrames(batchFrames);
      if (opts.mode === "frames") {
        const batchFramesByKind: Record<string, number> = {};
        let batchTextDeltaChars = 0;
        for (const frame of batchFrames) {
          batchFramesByKind[frame.kind] =
            (batchFramesByKind[frame.kind] ?? 0) + 1;
          if (frame.kind === "text_delta") {
            batchTextDeltaChars += frame.deltaChars;
          }
        }
        opts.log("channel render batch pushed", {
          turnId: opts.turnId,
          deliveryId: opts.deliveryId,
          batchSeq,
          frameCount: batchFrames.length,
          framesByKind: batchFramesByKind,
          textDeltaChars: batchTextDeltaChars,
          pushMs: round2(pushMs),
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
        batches: latencies.length,
        frames,
        framesByKind,
        textDeltaFrames,
        textDeltaChars,
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

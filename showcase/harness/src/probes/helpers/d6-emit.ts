import type { ProbeContext, ProbeResult } from "../../types/index.js";
import type {
  E2eFullAggregateSignal,
  E2eFullFeatureSignal,
} from "../drivers/d6-all-pills.js";

/**
 * Emit a per-feature side row (`d6:<slug>/<featureType>` or
 * `d5:<slug>/<featureType>`).
 *
 * Best-effort: writer failures are logged but never propagate to the
 * caller. Extracted from `d6-all-pills.ts` so `cli/e2e.ts` can write
 * the exact same PB row shape that the cron driver path produces.
 */
export async function sideEmit(
  ctx: ProbeContext,
  result: ProbeResult<E2eFullFeatureSignal>,
): Promise<void> {
  if (!ctx.writer) {
    ctx.logger.warn("probe.e2e-full.writer-missing", { key: result.key });
    return;
  }
  try {
    await ctx.writer.write(result);
  } catch (err) {
    ctx.logger.error("probe.e2e-full.side-emit-writer-failed", {
      key: result.key,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Emit the integration-scoped aggregate `d6:<slug>` (or `d5:<slug>`)
 * side row consumed by the showcase dashboard. The dashboard reads this
 * exact key (see `shell-dashboard/src/lib/live-status.ts` and
 * `shell-dashboard/src/components/depth-utils.ts`). The CLI driver path
 * (cli/targets.ts -> `key: d6:<slug>`) produces this shape as its
 * primary return; the cron path's primary key is
 * `d6-all-pills-e2e:<name>`, so without this explicit side-emit the
 * dashboard's D6 column stays permanently blank.
 *
 * Best-effort and isolated from primary-return semantics: failures here
 * are logged by `ctx.writer.write` but never propagate to the caller.
 */
export async function emitAggregate(
  ctx: ProbeContext,
  slug: string,
  result: ProbeResult<E2eFullAggregateSignal>,
  rowPrefix: "d5" | "d6",
): Promise<void> {
  const aggKey = `${rowPrefix}:${slug}`;
  if (!ctx.writer) {
    ctx.logger.warn("probe.e2e-full.aggregate-writer-missing", {
      key: aggKey,
    });
    return;
  }
  try {
    await ctx.writer.write({
      key: aggKey,
      state: result.state,
      signal: result.signal,
      observedAt: result.observedAt,
    });
  } catch (err) {
    ctx.logger.error("probe.e2e-full.aggregate-emit-failed", {
      key: aggKey,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

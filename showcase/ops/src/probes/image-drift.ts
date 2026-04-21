import type { Probe, ProbeContext, ProbeResult } from "../types/index.js";

export interface ImageDriftInput {
  /** list of pinned (service, digest) pairs for currently-deployed images. */
  deployed: { service: string; digest: string }[];
  /** callback returning the latest GHCR digest for a service. */
  fetchLatestDigest: (service: string) => Promise<string | null>;
}

export interface ImageDriftSignal {
  staleServices: string[];
  triggered: string[];
  /**
   * Services for which `fetchLatestDigest` returned null (GHCR outage, 404,
   * auth failure, etc). Sorted. Treated as red — we cannot assert freshness
   * without a successful upstream lookup. Distinguishing this from
   * `staleServices` lets operators tell "rebuild these" from "GHCR is down".
   */
  errored: string[];
  triggeredCount: number;
  erroredCount: number;
  rebuildNoun: string;
}

/**
 * Contract for YAML rule template authors (image-drift.yml):
 * - `signal.staleServices` — services whose deployed digest != latest GHCR digest.
 * - `signal.errored` — services whose GHCR lookup failed (null return). Treat as red.
 * - `signal.triggered` — union of staleServices + errored (message-friendly flat list).
 *   Ordering: stale first (sorted), then errored (sorted). A single service is
 *   categorized into exactly one bucket so the two sub-lists are disjoint.
 * - `signal.triggeredCount` / `signal.erroredCount` — counts for templates.
 * - `signal.rebuildNoun` — "rebuild" / "rebuilds" based on triggered.length.
 * Probe state is red when EITHER bucket is non-empty; green only when both are empty.
 */
export const imageDriftProbe: Probe<ImageDriftInput, ImageDriftSignal> = {
  dimension: "image_drift",
  async run(
    input: ImageDriftInput,
    ctx: ProbeContext,
  ): Promise<ProbeResult<ImageDriftSignal>> {
    // Dedupe by service name up-front so a single service can't appear in both
    // `stale` and `errored` buckets (or be checked twice) if the caller hands
    // us duplicate (service, digest) pairs. First occurrence wins.
    const seen = new Set<string>();
    const deduped: { service: string; digest: string }[] = [];
    for (const entry of input.deployed) {
      if (seen.has(entry.service)) continue;
      seen.add(entry.service);
      deduped.push(entry);
    }

    const stale: string[] = [];
    const errored: string[] = [];
    for (const { service, digest } of deduped) {
      const latest = await input.fetchLatestDigest(service);
      if (latest === null) {
        errored.push(service);
      } else if (latest !== digest) {
        stale.push(service);
      }
    }
    stale.sort();
    errored.sort();
    // Preserve stale-then-errored ordering (both sub-arrays already sorted).
    // Do NOT re-sort `triggered` or the template's "rebuild ... (failed lookups
    // listed last)" contract breaks.
    const triggered = [...stale, ...errored];
    const signal: ImageDriftSignal = {
      staleServices: stale,
      triggered,
      errored,
      triggeredCount: triggered.length,
      erroredCount: errored.length,
      rebuildNoun: triggered.length === 1 ? "rebuild" : "rebuilds",
    };
    return {
      key: "image_drift:global",
      state: triggered.length === 0 ? "green" : "red",
      signal,
      observedAt: ctx.now().toISOString(),
    };
  },
};

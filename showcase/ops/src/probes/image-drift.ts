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
   * Services for which `fetchLatestDigest` returned null OR threw (GHCR
   * outage, 404, auth failure, transient 5xx, etc). Sorted. Treated as red
   * — we cannot assert freshness without a successful upstream lookup.
   * Distinguishing this from `staleServices` lets operators tell
   * "rebuild these" from "GHCR is down". A single service's lookup failure
   * is isolated into this bucket and does NOT reject the whole probe —
   * one transient GHCR 502 must not blind us to drift on every other
   * service.
   */
  errored: string[];
  triggeredCount: number;
  erroredCount: number;
  staleServicesCount: number;
  rebuildNoun: string;
}

/**
 * Contract for YAML rule template authors (image-drift.yml):
 * - `signal.staleServices` — services whose deployed digest != latest GHCR digest.
 * - `signal.errored` — services whose GHCR lookup failed (null return). Treat as red.
 * - `signal.triggered` — union of staleServices + errored (message-friendly flat list).
 *   Ordering: stale first (sorted), then errored (sorted). A single service is
 *   categorized into exactly one bucket so the two sub-lists are disjoint.
 * - `signal.triggeredCount` / `signal.erroredCount` / `signal.staleServicesCount`
 *   — counts for templates.
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
    // Per-service try/catch — mirrors aimock-wiring's resilience pattern so
    // one transient GHCR 502 degrades to a partial report rather than killing
    // drift detection for every service.
    for (const { service, digest } of deduped) {
      try {
        const latest = await input.fetchLatestDigest(service);
        if (latest === null) {
          errored.push(service);
        } else if (latest !== digest) {
          stale.push(service);
        }
      } catch (err) {
        // Surface WHY on the errored bucket — without this log, operators see
        // an opaque "errored" list and have to dig through upstream logs to
        // figure out if it was a 502, 404, auth failure, etc. The probe still
        // degrades gracefully (service goes to errored bucket), but now the
        // cause is captured at warn level for diagnostics.
        ctx.logger.warn("image-drift service probe failed", {
          errorId: "IMAGE_DRIFT_SERVICE_ERROR",
          service,
          err: err instanceof Error ? err.message : String(err),
        });
        errored.push(service);
      }
    }
    stale.sort();
    errored.sort();
    // Preserve stale-then-errored ordering (both sub-arrays already sorted).
    // Do NOT re-sort `triggered` or the template's "rebuild ... (failed lookups
    // listed last)" contract breaks.
    const triggered = [...stale, ...errored];
    // Pluralize noun based on triggered count. count=0 → "rebuilds" is fine
    // (templates guard on triggeredCount>0 before rendering the phrase), but
    // count=1 must be "rebuild" (singular) or templates read "1 rebuilds".
    const signal: ImageDriftSignal = {
      staleServices: stale,
      triggered,
      errored,
      triggeredCount: triggered.length,
      erroredCount: errored.length,
      staleServicesCount: stale.length,
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

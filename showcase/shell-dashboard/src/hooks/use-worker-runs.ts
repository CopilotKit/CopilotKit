"use client";
/**
 * Poll hook for the worker-routed run summary (`/api/ops/runs` →
 * harness `GET /api/runs`, spec §5.2.1) — the §6.1 data layer.
 *
 * Mirrors `use-probes.ts`: ~10 s interval, AbortController cancellation,
 * per-effect `cancelled` closure (see the rationale comment there). What
 * it adds is the §6.1 three-way availability classification:
 *
 *   - HTTP 404                  → `misdeploy-404` (cold first poll and
 *     post-success alike — see EXPECT_WORKER_RUNS_ENDPOINT below)
 *   - any other fetch/parse/5xx → `unreachable`
 *   - 200 body where ANY family entry carries the §5.2.1
 *     `error: "history_unavailable"` marker → `history-backend`
 *     (PB down while the CP answers — the response succeeded but the
 *     measurement behind it did not)
 *
 * Last-good data + its fetch timestamp are retained across unavailable
 * states so the §6.3 panel can render the dimmed stale table. Recovery is
 * automatic on the next successful poll; deliberately NO debounce — a
 * transient single-poll blip flashing the state briefly is preferred over
 * any delay in surfacing an outage (§6.1).
 */
import { useEffect, useRef, useState } from "react";

import {
  fetchWorkerRuns,
  OpsApiHttpError,
  type WorkerRunsResponse,
} from "../lib/ops-api";

// §6.1: source-level constant, compiled into the same bundle as the fetch
// code. Deliberately NOT env/build config (no-public-env-shell-read rule —
// the only env route to a client-visible build value is NEXT_PUBLIC_*,
// which the oxlint rule bans in shell source; see the rule comment in
// src/app/api/ops/[...path]/route.ts). Any build that can receive a 404
// from /api/ops/runs ships this constant, so a 404 is ALWAYS the
// misdeploy incident class — no skew state exists: a build without the
// constant is pre-P3 code with no worker-runs section and no fetch.
// Flippable only by a deliberate code change.
export const EXPECT_WORKER_RUNS_ENDPOINT: boolean = true;

const DEFAULT_INTERVAL_MS = 10_000;

/** §6.1 unavailable classification — drives the §6.3 message variants. */
export type WorkerRunsUnavailableKind =
  | "misdeploy-404"
  | "unreachable"
  | "history-backend";

export type WorkerRunsStatus =
  | { status: "ok"; data: WorkerRunsResponse; fetchedAt: number }
  | {
      status: "unavailable";
      kind: WorkerRunsUnavailableKind;
      lastGood: { data: WorkerRunsResponse; fetchedAt: number } | null;
    };

/**
 * Poll `/api/ops/runs` on the same ~10 s cadence as the probe poll.
 *
 * Returns `null` until the first poll settles — the same "no data yet"
 * value the `WorkerRunsContext` default carries, so consumers have exactly
 * one no-data case to handle (render no glyph/banner/section content).
 */
export function useWorkerRunsPoll(opts?: {
  intervalMs?: number;
  baseUrl?: string;
}): WorkerRunsStatus | null {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const baseUrl = opts?.baseUrl;

  const [status, setStatus] = useState<WorkerRunsStatus | null>(null);

  // Last successful body + timestamp, surfaced on every unavailable state
  // (§6.3 "last good data <relative>" + dimmed table). A ref, not state:
  // it only ever renders THROUGH a status update.
  const lastGoodRef = useRef<{
    data: WorkerRunsResponse;
    fetchedAt: number;
  } | null>(null);
  // Same cancellation pattern as use-probes.ts: controllerRef cancels the
  // in-flight request across interval ticks; cancelledRef mirrors the
  // active effect's cancelled flag.
  const controllerRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef<boolean>(false);

  useEffect(() => {
    cancelledRef.current = false;
    // Dep change (baseUrl swap): drop data from the prior target — both the
    // rendered status and the last-good cache, which would otherwise
    // resurface stale cross-target data inside an unavailable panel.
    setStatus(null);
    lastGoodRef.current = null;

    async function run(): Promise<void> {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      try {
        const data = await fetchWorkerRuns({
          signal: controller.signal,
          baseUrl,
        });
        if (cancelledRef.current || controller.signal.aborted) return;
        const fetchedAt = Date.now();
        // §6.1: a 200 body carrying any family-entry degradation marker is
        // the SAME incident class as a failed poll — the response
        // succeeded but the measurement behind it did not. It is not
        // last-good data.
        const degraded = data.families.some(
          (family) => family.error === "history_unavailable",
        );
        if (degraded) {
          setStatus({
            status: "unavailable",
            kind: "history-backend",
            lastGood: lastGoodRef.current,
          });
          return;
        }
        lastGoodRef.current = { data, fetchedAt };
        setStatus({ status: "ok", data, fetchedAt });
      } catch (err) {
        if (cancelledRef.current || controller.signal.aborted) return;
        // AbortError is expected during teardown / interval rollover.
        if ((err as { name?: string })?.name === "AbortError") return;
        // §6.1 404 rule: every build that performs this fetch ships
        // EXPECT_WORKER_RUNS_ENDPOINT, so a 404 is always the misdeploy
        // incident class — cold first poll and post-success alike.
        const isMisdeploy404 =
          EXPECT_WORKER_RUNS_ENDPOINT &&
          err instanceof OpsApiHttpError &&
          err.status === 404;
        setStatus({
          status: "unavailable",
          kind: isMisdeploy404 ? "misdeploy-404" : "unreachable",
          lastGood: lastGoodRef.current,
        });
      }
    }

    void run();
    const timer = setInterval(() => {
      void run();
    }, intervalMs);
    return () => {
      cancelledRef.current = true;
      clearInterval(timer);
      controllerRef.current?.abort();
    };
  }, [baseUrl, intervalMs]);

  return status;
}

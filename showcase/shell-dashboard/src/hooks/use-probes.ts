"use client";
/**
 * React hooks layered on top of `lib/ops-api`. Provide:
 *   - `useProbes()`           — list view, polled every `intervalMs` (default 10s).
 *   - `useProbeDetail(id)`    — single-probe drilldown, polled.
 *   - `useTriggerProbe()`     — POST /trigger mutation with a `pending` flag.
 *
 * All hooks use AbortController to cancel in-flight requests on unmount or
 * when polling intervals tick over, so a slow API call never lands a
 * setState into a torn-down component (and never lands stale data on top
 * of fresh data when the user changes selection rapidly).
 *
 * Cancellation pattern: each `useEffect` declares a local `let cancelled =
 * false;` closure that the cleanup flips to true. We do NOT re-use a single
 * `aliveRef` for this purpose: aliveRef would be reset to true on every
 * effect run, defeating the guard against stale data from a prior cycle's
 * fetch resolving after cleanup. The component-lifetime aliveRef remains
 * for the trigger callback (which lives outside any effect).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchProbes,
  fetchProbeDetail,
  triggerProbe,
  type ProbesResponse,
  type ProbeScheduleEntry,
  type ProbeRun,
  type TriggerResponse,
} from "../lib/ops-api";

const DEFAULT_INTERVAL_MS = 10_000;

// ─────────────────────────────────────────────────────────────────────────
// useProbes — list, polled
// ─────────────────────────────────────────────────────────────────────────

export interface UseProbesResult {
  data: ProbesResponse | null;
  error: Error | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

export function useProbes(opts?: {
  intervalMs?: number;
  baseUrl?: string;
}): UseProbesResult {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const baseUrl = opts?.baseUrl;

  const [data, setData] = useState<ProbesResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // `controllerRef` holds the current AbortController so that interval
  // ticks and refetch calls can cancel the previous in-flight request
  // before kicking off a new one. The per-effect `cancelled` flag (set in
  // the effect closure below) handles the dep-change / unmount case.
  const controllerRef = useRef<AbortController | null>(null);
  // `cancelledRef` mirrors the active effect's `cancelled` flag so the
  // imperative `refetch` callback can honor it too. Each effect run resets
  // this to false on entry; cleanup flips to true.
  const cancelledRef = useRef<boolean>(false);

  const run = useCallback(async (): Promise<void> => {
    // Cancel any in-flight request before starting a new one. This is
    // the critical invariant for fast polling + manual refetch interleaving.
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await fetchProbes({ signal: controller.signal, baseUrl });
      if (cancelledRef.current || controller.signal.aborted) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (cancelledRef.current || controller.signal.aborted) return;
      // AbortError is expected during teardown / interval rollover and
      // must not surface as a user-facing error.
      if ((err as { name?: string })?.name === "AbortError") return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (!cancelledRef.current && !controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [baseUrl]);

  useEffect(() => {
    cancelledRef.current = false;
    // Surface a "refreshing" indicator across dep changes (baseUrl swap)
    // so consumers can render a loading state instead of stale data.
    setLoading(true);
    // R3-C.3: clear any error from the prior dep tuple (e.g. previous
    // baseUrl). Otherwise an error from a stale baseUrl persists under the
    // new one until a fresh failure or successful fetch overwrites it.
    setError(null);
    // R4-B.1: clear data on dep change too — symmetry with useProbeDetail
    // (CR-B1.4). Without this, the dashboard renders stale list data from
    // the previous baseUrl until the new fetch resolves, which is
    // inconsistent with how the detail panel handles id changes.
    setData(null);
    void run();
    const timer = setInterval(() => {
      void run();
    }, intervalMs);
    return () => {
      cancelledRef.current = true;
      clearInterval(timer);
      controllerRef.current?.abort();
    };
  }, [run, intervalMs]);

  const refetch = useCallback(async (): Promise<void> => {
    await run();
  }, [run]);

  return { data, error, loading, refetch };
}

// ─────────────────────────────────────────────────────────────────────────
// useProbeDetail — drilldown, polled, gated on non-null id
// ─────────────────────────────────────────────────────────────────────────

export interface UseProbeDetailResult {
  data: { probe: ProbeScheduleEntry; runs: ProbeRun[] } | null;
  error: Error | null;
  loading: boolean;
}

export function useProbeDetail(
  id: string | null,
  opts?: { intervalMs?: number; baseUrl?: string },
): UseProbeDetailResult {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const baseUrl = opts?.baseUrl;

  const [data, setData] = useState<UseProbeDetailResult["data"]>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Per-effect cancellation flag: scoped to THIS effect run only. A new
    // effect (e.g. id change) gets its own `cancelled` closure, so a stale
    // fetch from the prior cycle that resolves after cleanup cannot slip
    // its setData past this guard.
    let cancelled = false;
    if (!id) {
      // Clear stale data when the caller deselects the drilldown — keeping
      // an old probe visible behind a null id would mislead the operator.
      setData(null);
      setError(null);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    // CR-B1.4: clear the previous probe's data immediately on id change so
    // the panel header (driven by the prop) is never out of sync with the
    // data body. The new fetch will repopulate this on resolution.
    setData(null);
    // R3-C.2: also clear any error from the prior probe so the detail panel
    // doesn't render a stale error message under the new probe header. Set
    // before flipping `loading` so the UI never shows error+loading at once
    // for the new id.
    setError(null);
    setLoading(true);

    async function run(): Promise<void> {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      try {
        // `id` is non-null here — the early return above handles the null
        // path. Narrow once for the closure.
        const result = await fetchProbeDetail(id as string, {
          signal: controller.signal,
          baseUrl,
        });
        if (cancelled || controller.signal.aborted) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        if ((err as { name?: string })?.name === "AbortError") return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled && !controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void run();
    const timer = setInterval(() => {
      void run();
    }, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
      controllerRef.current?.abort();
    };
  }, [id, intervalMs, baseUrl]);

  return { data, error, loading };
}

// ─────────────────────────────────────────────────────────────────────────
// useTriggerProbe — POST /trigger mutation
// ─────────────────────────────────────────────────────────────────────────

export interface UseTriggerProbeResult {
  /**
   * Trigger a probe run.
   *
   * Resolves to a `TriggerResponse` on success. Resolves to `null` when the
   * call is superseded by a back-to-back trigger (the AbortError is swallowed
   * — see R2-C.2). Callers that care about the response must null-check.
   * Throws on real failures (missing token, server error, etc.).
   */
  trigger: (
    probeId: string,
    slugs?: string[],
  ) => Promise<TriggerResponse | null>;
  pending: boolean;
  error: Error | null;
}

export function useTriggerProbe(opts?: {
  token?: string;
  baseUrl?: string;
}): UseTriggerProbeResult {
  const token = opts?.token;
  const baseUrl = opts?.baseUrl;

  const [pending, setPending] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Component-lifetime alive flag — the trigger callback is invoked
  // imperatively, not from an effect, so the per-effect `cancelled` pattern
  // doesn't apply here. Flip on unmount only.
  const aliveRef = useRef(true);
  // Track the in-flight trigger's controller so back-to-back triggers can
  // cancel each other. Note: we do NOT abort this on unmount — see below.
  const triggerControllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      // R2-C.1: intentionally do NOT abort triggerControllerRef on unmount.
      // POST is non-idempotent — the server may have already received the
      // request and queued the run. Aborting client-side does NOT unfire
      // the server-side action, it just hides the result. Allow the POST
      // to complete; aliveRef gates any setState after unmount.
    };
  }, []);

  const trigger = useCallback(
    async (
      probeId: string,
      slugs?: string[],
    ): Promise<TriggerResponse | null> => {
      if (!token) {
        const err = new Error(
          "useTriggerProbe: token is required to trigger a probe run",
        );
        if (aliveRef.current) setError(err);
        throw err;
      }
      if (aliveRef.current) {
        setPending(true);
        // R3-C.4: clear any prior trigger error eagerly so a successful
        // call doesn't leave a stale error hanging on the result object.
        setError(null);
      }
      // Replace any prior in-flight controller — back-to-back triggers
      // should cancel the previous attempt rather than race it.
      triggerControllerRef.current?.abort();
      const controller = new AbortController();
      triggerControllerRef.current = controller;
      try {
        const result = await triggerProbe(probeId, {
          slugs,
          token,
          baseUrl,
          signal: controller.signal,
        });
        // R4-B.6: if a back-to-back trigger aborted this controller AFTER
        // the fetch resolved (real-world race — fetch already committed
        // before the abort signal propagated), honor the supersession
        // contract and resolve to `null`. Without this guard, the try
        // block would return the resolved TriggerResponse and contradict
        // the documented R3-C.1 contract that callers rely on.
        if (controller.signal.aborted) return null;
        return result;
      } catch (err) {
        // R2-C.2: AbortError here means this call was superseded by a
        // newer trigger (back-to-back). It's not a user-facing error —
        // swallow it instead of surfacing on `error` or rethrowing.
        const isAbort =
          (err as { name?: string })?.name === "AbortError" ||
          controller.signal.aborted;
        if (isAbort) {
          // R3-C.1: resolve with `null` (typed in the signature) so callers
          // can discriminate supersession without a type-system lie. The
          // previous `undefined as unknown as TriggerResponse` violated the
          // declared contract.
          return null;
        }
        const e = err instanceof Error ? err : new Error(String(err));
        if (aliveRef.current) setError(e);
        throw e;
      } finally {
        // Only the controller that "owns" the latest trigger should clear
        // pending — a superseded controller's finally still runs but must
        // not flip pending off while a newer call is in flight.
        if (aliveRef.current && triggerControllerRef.current === controller) {
          setPending(false);
        }
      }
    },
    [token, baseUrl],
  );

  return { trigger, pending, error };
}

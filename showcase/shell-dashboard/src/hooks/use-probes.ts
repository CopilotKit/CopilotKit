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

  // `aliveRef` guards setState calls against post-unmount fetches that
  // resolve after cleanup ran. `controllerRef` holds the current
  // AbortController so that interval ticks and refetch calls can cancel
  // the previous in-flight request before kicking off a new one.
  const aliveRef = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);

  const run = useCallback(async (): Promise<void> => {
    // Cancel any in-flight request before starting a new one. This is
    // the critical invariant for fast polling + manual refetch interleaving.
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await fetchProbes({ signal: controller.signal, baseUrl });
      if (!aliveRef.current || controller.signal.aborted) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (!aliveRef.current || controller.signal.aborted) return;
      // AbortError is expected during teardown / interval rollover and
      // must not surface as a user-facing error.
      if ((err as { name?: string })?.name === "AbortError") return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (aliveRef.current && !controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [baseUrl]);

  useEffect(() => {
    aliveRef.current = true;
    void run();
    const timer = setInterval(() => {
      void run();
    }, intervalMs);
    return () => {
      aliveRef.current = false;
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

  const aliveRef = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    if (!id) {
      // Clear stale data when the caller deselects the drilldown — keeping
      // an old probe visible behind a null id would mislead the operator.
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

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
        if (!aliveRef.current || controller.signal.aborted) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (!aliveRef.current || controller.signal.aborted) return;
        if ((err as { name?: string })?.name === "AbortError") return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (aliveRef.current && !controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void run();
    const timer = setInterval(() => {
      void run();
    }, intervalMs);
    return () => {
      aliveRef.current = false;
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
  trigger: (probeId: string, slugs?: string[]) => Promise<TriggerResponse>;
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

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const trigger = useCallback(
    async (probeId: string, slugs?: string[]): Promise<TriggerResponse> => {
      if (!token) {
        const err = new Error(
          "useTriggerProbe: token is required to trigger a probe run",
        );
        if (aliveRef.current) setError(err);
        throw err;
      }
      if (aliveRef.current) {
        setPending(true);
        setError(null);
      }
      try {
        const result = await triggerProbe(probeId, { slugs, token, baseUrl });
        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (aliveRef.current) setError(e);
        throw e;
      } finally {
        if (aliveRef.current) setPending(false);
      }
    },
    [token, baseUrl],
  );

  return { trigger, pending, error };
}

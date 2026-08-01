import { useCallback, useEffect, useRef, useState } from "react";
import type { MaybePromise } from "@copilotkit/shared";

export type HeaderRecord = Record<string, string>;
export type HeaderSource = HeaderRecord | (() => MaybePromise<HeaderRecord>);

export interface ResolvedHeaders {
  headers: HeaderRecord;
  ready: boolean;
  error: Error | null;
}

interface PendingReadiness {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

type HeaderEvaluation =
  | { kind: "sync"; headers: HeaderRecord }
  | { kind: "async"; promise: PromiseLike<HeaderRecord> }
  | { kind: "error"; error: Error };

const EMPTY_HEADERS: HeaderRecord = Object.freeze({}) as HeaderRecord;

function isHeaderRecord(value: unknown): value is HeaderRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function invalidHeadersError(): Error {
  return new Error("Resolved request headers must be a record of strings");
}

function sameHeaders(left: HeaderRecord, right: HeaderRecord): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Header resolution failed");
}

function evaluate(source: HeaderSource): HeaderEvaluation {
  try {
    const result = typeof source === "function" ? source() : source;
    if (
      (typeof result === "object" && result !== null) ||
      typeof result === "function"
    ) {
      const then = (result as { then?: unknown }).then;
      if (typeof then === "function") {
        return { kind: "async", promise: result as PromiseLike<HeaderRecord> };
      }
    }
    return isHeaderRecord(result)
      ? { kind: "sync", headers: result }
      : { kind: "error", error: invalidHeadersError() };
  } catch (error) {
    return { kind: "error", error: toError(error) };
  }
}

/** Resolve provider headers without allowing promise-shaped values into core. */
export function useResolvedHeaders(source: HeaderSource): ResolvedHeaders {
  const evaluationRef = useRef<{
    source: HeaderSource;
    evaluation: HeaderEvaluation;
  } | null>(null);
  let evaluation: HeaderEvaluation;

  if (
    evaluationRef.current === null ||
    evaluationRef.current.source !== source ||
    evaluationRef.current.evaluation.kind === "sync" ||
    evaluationRef.current.evaluation.kind === "error"
  ) {
    evaluation = evaluate(source);
    if (
      evaluationRef.current?.evaluation.kind === "sync" &&
      evaluation.kind === "sync" &&
      sameHeaders(evaluationRef.current.evaluation.headers, evaluation.headers)
    ) {
      evaluation = evaluationRef.current.evaluation;
    }
    evaluationRef.current = { source, evaluation };
  } else {
    evaluation = evaluationRef.current.evaluation;
  }
  const hasSettledRef = useRef(evaluation.kind === "sync");
  const lastGoodHeadersRef = useRef(
    evaluation.kind === "sync" ? evaluation.headers : EMPTY_HEADERS,
  );
  const attemptRef = useRef(0);
  const [state, setState] = useState<{
    ready: boolean;
    error: Error | null;
  }>(() => {
    if (evaluation.kind === "sync") {
      return { ready: true, error: null };
    }
    return { ready: false, error: null };
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const attempt = ++attemptRef.current;
    let active = true;

    const reportError = (_error: Error) => {
      if (!active || attempt !== attemptRef.current) return;
      console.error("[CopilotKit] Failed to resolve request headers");
    };

    const publishError = (error: Error) => {
      reportError(error);
      if (!active || attempt !== attemptRef.current) return;
      setState((previous) =>
        previous.ready === hasSettledRef.current && previous.error === error
          ? previous
          : { ready: hasSettledRef.current, error },
      );
    };

    if (evaluation.kind === "sync") {
      lastGoodHeadersRef.current = evaluation.headers;
      hasSettledRef.current = true;
      setState((previous) =>
        previous.ready && previous.error === null
          ? previous
          : { ready: true, error: null },
      );
      return () => {
        active = false;
      };
    }

    if (evaluation.kind === "error") {
      // The error is already visible in render, so avoid consuming the next-render retry.
      reportError(evaluation.error);
      return () => {
        active = false;
      };
    }

    if (stateRef.current.error !== null) {
      setState((previous) =>
        previous.error === null ? previous : { ...previous, error: null },
      );
    }
    Promise.resolve(evaluation.promise).then(
      (headers) => {
        if (!active || attempt !== attemptRef.current) return;
        if (!isHeaderRecord(headers)) {
          publishError(invalidHeadersError());
          return;
        }
        const changed = !sameHeaders(lastGoodHeadersRef.current, headers);
        if (changed) lastGoodHeadersRef.current = headers;
        hasSettledRef.current = true;
        setState((previous) =>
          !changed && previous.ready && previous.error === null
            ? previous
            : { ready: true, error: null },
        );
      },
      (error: unknown) => publishError(toError(error)),
    );

    return () => {
      active = false;
    };
  }, [evaluation]);

  if (evaluation.kind === "sync") {
    return { headers: evaluation.headers, ready: true, error: null };
  }

  return {
    headers: lastGoodHeadersRef.current,
    ready: hasSettledRef.current ? state.ready : false,
    error: evaluation.kind === "error" ? evaluation.error : state.error,
  };
}

/**
 * Wait for the provider's initial header resolution without blocking refreshes.
 * Returns `undefined` when headers are already settled so callers keep their
 * pre-existing synchronous dispatch timing instead of deferring a tick.
 */
export function useHeaderReadiness(
  ready: boolean,
  error: Error | null,
): () => void | Promise<void> {
  const statusRef = useRef({ ready, error });
  statusRef.current = { ready, error };
  const pendingRef = useRef<PendingReadiness | null>(null);
  const unmountedRef = useRef(false);
  const cancellationErrorRef = useRef<Error | null>(null);
  const lifecycleRef = useRef({ generation: 0, mounted: false });

  const waitForHeaders = useCallback((): void | Promise<void> => {
    if (unmountedRef.current) {
      return Promise.reject(
        cancellationErrorRef.current ??
          new Error("Header readiness was canceled"),
      );
    }
    const status = statusRef.current;
    if (status.ready) return undefined;
    if (status.error) return Promise.reject(status.error);
    if (pendingRef.current) return pendingRef.current.promise;

    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    pendingRef.current = { promise, resolve, reject };
    return promise;
  }, []);

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    if (ready) {
      pendingRef.current = null;
      pending.resolve();
    } else if (error) {
      pendingRef.current = null;
      pending.reject(error);
    }
  }, [ready, error]);

  useEffect(() => {
    const generation = lifecycleRef.current.generation + 1;
    lifecycleRef.current = { generation, mounted: true };
    unmountedRef.current = false;

    return () => {
      lifecycleRef.current = { generation, mounted: false };

      // React StrictMode replays passive effects by running cleanup and setup
      // back-to-back. Defer cancellation until a setup has had a chance to
      // replace this lifecycle, which leaves rejection for real unmounts.
      void Promise.resolve().then(() => {
        if (
          lifecycleRef.current.generation !== generation ||
          lifecycleRef.current.mounted
        ) {
          return;
        }

        unmountedRef.current = true;
        const cancellationError = new Error("Header readiness was canceled");
        cancellationErrorRef.current = cancellationError;
        const pending = pendingRef.current;
        if (!pending) return;
        pendingRef.current = null;
        pending.reject(cancellationError);
      });
    };
  }, []);

  return waitForHeaders;
}

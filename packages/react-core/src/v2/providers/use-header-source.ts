import { useEffect, useRef, useState } from "react";
import type { MaybePromise } from "@copilotkit/shared";

export type HeaderRecord = Record<string, string>;
export type HeaderSource = HeaderRecord | (() => MaybePromise<HeaderRecord>);
type HeaderInput = Record<string, string | null | undefined>;

type Evaluation =
  | { kind: "sync"; value: HeaderRecord }
  | { kind: "async"; value: PromiseLike<unknown> }
  | { kind: "error"; error: Error };

const EMPTY: HeaderRecord = Object.freeze({}) as HeaderRecord;

function isRecord(value: unknown): value is HeaderInput {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (entry) => entry == null || typeof entry === "string",
    )
  );
}

function normalizeHeaders(value: HeaderInput): HeaderRecord {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => entry[1] != null,
    ),
  );
}

function sameHeaders(left: HeaderRecord, right: HeaderRecord): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

function errorFrom(value: unknown): Error {
  return value instanceof Error ? value : new Error("Header resolution failed");
}

function evaluate(source: HeaderSource): Evaluation {
  try {
    const value = typeof source === "function" ? source() : source;
    if (
      (typeof value === "object" && value !== null) ||
      typeof value === "function"
    ) {
      const then = (value as { then?: unknown }).then;
      if (typeof then === "function") {
        return { kind: "async", value: value as PromiseLike<HeaderRecord> };
      }
    }
    return isRecord(value)
      ? { kind: "sync", value: normalizeHeaders(value) }
      : {
          kind: "error",
          error: new Error(
            "Resolved request headers must be a record of strings, null, or undefined",
          ),
        };
  } catch (error) {
    return { kind: "error", error: errorFrom(error) };
  }
}

export function useHeaderSource(source: HeaderSource): {
  headers: HeaderRecord | null;
  error: Error | null;
  status: "pending" | "ready" | "failed";
} {
  const evaluationRef = useRef<{
    source: HeaderSource;
    value: Evaluation;
    settled: boolean;
  } | null>(null);
  const previous = evaluationRef.current;
  const holdPendingEvaluation =
    previous?.value.kind === "async" && !previous.settled;
  const evaluation = holdPendingEvaluation
    ? previous.value
    : previous &&
        previous.source === source &&
        (previous.value.kind === "async" || previous.value.kind === "error")
      ? previous.value
      : evaluate(source);
  if (
    !holdPendingEvaluation &&
    (!previous ||
      previous.source !== source ||
      (previous.value.kind !== "async" && previous.value.kind !== "error"))
  ) {
    if (
      previous?.source === source &&
      previous.value.kind === "sync" &&
      evaluation.kind === "sync" &&
      sameHeaders(previous.value.value, evaluation.value)
    ) {
      evaluationRef.current = previous;
    } else {
      evaluationRef.current = {
        source,
        value: evaluation,
        settled: evaluation.kind !== "async",
      };
    }
  }

  const generation = useRef(0);
  const effectiveSource = evaluationRef.current!.source;
  const sourceIdentity = useRef(effectiveSource);
  if (sourceIdentity.current !== effectiveSource) {
    sourceIdentity.current = effectiveSource;
    generation.current += 1;
  }

  const canonicalEvaluation = evaluationRef.current!.value;
  const initial =
    canonicalEvaluation.kind === "sync" ? canonicalEvaluation.value : null;
  const [state, setState] = useState<{
    headers: HeaderRecord | null;
    error: Error | null;
  }>(() => ({
    headers: initial,
    error:
      canonicalEvaluation.kind === "error" ? canonicalEvaluation.error : null,
  }));
  const lastGood = useRef(initial ?? EMPTY);
  const warnedPendingReplacement = useRef(false);
  const previousSource = useRef(source);
  if (
    previousSource.current !== source &&
    canonicalEvaluation.kind === "async" &&
    holdPendingEvaluation &&
    !warnedPendingReplacement.current &&
    process.env.NODE_ENV !== "production"
  ) {
    warnedPendingReplacement.current = true;
    console.warn(
      "[CopilotKit] An async headers source changed while the previous source was pending; the current pending evaluation remains authoritative until it settles. Memoize the source to refresh it only when intended.",
    );
  }
  previousSource.current = source;

  useEffect(() => {
    const current = generation.current;
    let active = true;
    if (canonicalEvaluation.kind === "sync") {
      lastGood.current = canonicalEvaluation.value;
      return () => {
        active = false;
      };
    }
    if (canonicalEvaluation.kind === "error") {
      return () => {
        active = false;
      };
    }
    setState((previousState) =>
      previousState.error === null
        ? previousState
        : { headers: previousState.headers, error: null },
    );
    Promise.resolve(canonicalEvaluation.value).then(
      (headers) => {
        if (evaluationRef.current?.value === canonicalEvaluation) {
          evaluationRef.current.settled = true;
        }
        if (!active || current !== generation.current || !isRecord(headers)) {
          if (active && current === generation.current && !isRecord(headers)) {
            setState({
              headers: lastGood.current === EMPTY ? null : lastGood.current,
              error: new Error(
                "Resolved request headers must be a record of strings, null, or undefined",
              ),
            });
          }
          return;
        }
        const normalized = normalizeHeaders(headers);
        lastGood.current = normalized;
        if (!active || current !== generation.current) return;
        setState((previousState) =>
          previousState.error === null &&
          previousState.headers !== null &&
          sameHeaders(previousState.headers, normalized)
            ? previousState
            : { headers: normalized, error: null },
        );
      },
      (error) => {
        if (evaluationRef.current?.value === canonicalEvaluation) {
          evaluationRef.current.settled = true;
        }
        if (!active || current !== generation.current) return;
        setState({
          headers: lastGood.current === EMPTY ? null : lastGood.current,
          error: errorFrom(error),
        });
      },
    );
    return () => {
      active = false;
    };
  }, [canonicalEvaluation]);

  return {
    headers:
      canonicalEvaluation.kind === "sync"
        ? canonicalEvaluation.value
        : lastGood.current === EMPTY
          ? (state.headers ?? EMPTY)
          : lastGood.current,
    error:
      canonicalEvaluation.kind === "error"
        ? canonicalEvaluation.error
        : canonicalEvaluation.kind === "sync"
          ? null
          : previous?.source === source
            ? state.error
            : null,
    status:
      canonicalEvaluation.kind === "sync"
        ? "ready"
        : canonicalEvaluation.kind === "error"
          ? lastGood.current !== EMPTY
            ? "ready"
            : "failed"
          : state.error && previous?.source === source
            ? lastGood.current !== EMPTY
              ? "ready"
              : "failed"
            : state.headers || lastGood.current !== EMPTY
              ? "ready"
              : "pending",
  };
}

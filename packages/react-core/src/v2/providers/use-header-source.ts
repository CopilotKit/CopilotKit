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
} {
  const evaluationRef = useRef<{
    source: HeaderSource;
    value: Evaluation;
  } | null>(null);
  const previous = evaluationRef.current;
  const evaluation =
    previous &&
    previous.source === source &&
    (previous.value.kind === "async" || previous.value.kind === "error")
      ? previous.value
      : evaluate(source);
  if (
    !previous ||
    previous.source !== source ||
    (previous.value.kind !== "async" && previous.value.kind !== "error")
  ) {
    if (
      previous?.source === source &&
      previous.value.kind === "sync" &&
      evaluation.kind === "sync" &&
      sameHeaders(previous.value.value, evaluation.value)
    ) {
      evaluationRef.current = previous;
    } else {
      evaluationRef.current = { source, value: evaluation };
    }
  }

  const generation = useRef(0);
  const sourceIdentity = useRef(source);
  if (sourceIdentity.current !== source) {
    sourceIdentity.current = source;
    generation.current += 1;
  }

  const initial = evaluation.kind === "sync" ? evaluation.value : null;
  const [state, setState] = useState<{
    headers: HeaderRecord | null;
    error: Error | null;
  }>(() => ({
    headers: initial,
    error: evaluation.kind === "error" ? evaluation.error : null,
  }));
  const lastGood = useRef(initial ?? EMPTY);

  useEffect(() => {
    const current = generation.current;
    let active = true;
    if (evaluation.kind === "sync") {
      lastGood.current = evaluation.value;
      return () => {
        active = false;
      };
    }
    if (evaluation.kind === "error") {
      return () => {
        active = false;
      };
    }
    setState((previousState) =>
      previousState.error === null
        ? previousState
        : { headers: previousState.headers, error: null },
    );
    Promise.resolve(evaluation.value).then(
      (headers) => {
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
        setState({ headers: normalized, error: null });
      },
      (error) => {
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
  }, [evaluation]);

  return {
    headers:
      evaluation.kind === "sync"
        ? evaluation.value
        : lastGood.current === EMPTY
          ? state.headers
          : lastGood.current,
    error:
      evaluation.kind === "error"
        ? evaluation.error
        : evaluation.kind === "sync"
          ? null
          : previous?.source === source
            ? state.error
            : null,
  };
}

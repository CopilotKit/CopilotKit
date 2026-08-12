import { useEffect, useRef, useState } from "react";
import type { MaybePromise } from "@copilotkit/shared";

export type HeaderRecord = Record<string, string>;
export type HeaderSource = HeaderRecord | (() => MaybePromise<HeaderRecord>);

type Evaluation =
  | { kind: "sync"; value: HeaderRecord }
  | { kind: "async"; value: PromiseLike<HeaderRecord> }
  | { kind: "error"; error: Error };

const EMPTY: HeaderRecord = Object.freeze({}) as HeaderRecord;

function isRecord(value: unknown): value is HeaderRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
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
      ? { kind: "sync", value }
      : {
          kind: "error",
          error: new Error(
            "Resolved request headers must be a record of strings",
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
    evaluationRef.current = { source, value: evaluation };
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
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
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
                "Resolved request headers must be a record of strings",
              ),
            });
          }
          return;
        }
        lastGood.current = headers;
        if (!active || current !== generation.current) return;
        setState({ headers, error: null });
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
    headers: evaluation.kind === "sync" ? evaluation.value : state.headers,
    error: evaluation.kind === "error" ? evaluation.error : state.error,
  };
}

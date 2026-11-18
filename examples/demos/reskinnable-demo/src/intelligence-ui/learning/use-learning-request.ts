/* eslint-disable react-hooks/set-state-in-effect -- copied verbatim from the Intelligence web app, whose lint config does not enable the React Compiler rules. */
import { useEffect, useState } from "react";

export type LearningRequestState<T> =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly data: T; readonly status: "ready" }
  | { readonly data: T; readonly status: "empty" }
  | { readonly message: string; readonly status: "error" };

/** Returns a safe, short error message for one request failure. */
function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The Automatic Learning request failed.";
}

/** Returns whether a loaded collection has no records. */
function isEmptyCollection(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

/**
 * Runs one abortable Learning read and ignores cancelled or stale completions.
 *
 * @param load - Stable loader, or null when no request should run.
 * @param refresh - Invalidates the same read without clearing its last result.
 * @returns Discriminated request state for direct rendering.
 */
export function useLearningRequest<T>(
  load: ((signal: AbortSignal) => Promise<T>) | null,
  refresh = 0,
): LearningRequestState<T> {
  const [state, setState] = useState<LearningRequestState<T>>(
    load === null ? { status: "idle" } : { status: "loading" },
  );

  // A new loader identifies a different resource. Only same-loader refreshes
  // may retain the previous response while the next request is pending.
  useEffect(() => {
    setState(load === null ? { status: "idle" } : { status: "loading" });
  }, [load]);

  useEffect(() => {
    if (load === null) return undefined;

    const controller = new AbortController();
    let active = true;
    load(controller.signal).then(
      (data) => {
        if (!active || controller.signal.aborted) return;
        setState({
          data,
          status: isEmptyCollection(data) ? "empty" : "ready",
        });
      },
      (error: unknown) => {
        if (!active || controller.signal.aborted) return;
        setState({ message: errorMessage(error), status: "error" });
      },
    );

    return () => {
      active = false;
      controller.abort();
    };
  }, [load, refresh]);

  return state;
}

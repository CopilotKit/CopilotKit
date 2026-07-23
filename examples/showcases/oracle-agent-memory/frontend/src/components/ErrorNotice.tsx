"use client";

import { useEffect, useState } from "react";
import { useAgent } from "@copilotkit/react-core/v2";

const AGENT_ID = "oracle_concierge";

/** A friendlier, shorter message for known failure shapes. */
function humanize(raw: string): string {
  if (
    /must be a response to a preceeding message with 'tool_calls'/.test(raw)
  ) {
    return "This conversation hit a known multi-turn limitation in the Agent Spec × AG-UI adapter. Start a new thread to continue.";
  }
  return "The agent run failed. Please try again or start a new thread.";
}

/**
 * Surfaces a run's RUN_ERROR, which the chat UI otherwise swallows (it arrives
 * after RUN_FINISHED), so a failed turn no longer looks like a dead app.
 */
export function ErrorNotice() {
  const { agent } = useAgent({ agentId: AGENT_ID });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agent) return;
    const { unsubscribe } = agent.subscribe({
      // Clear any prior error when a new run begins.
      onRunStartedEvent: () => setError(null),
      // SSE RUN_ERROR (e.g. the agent raised mid-run) — chat UI swallows this.
      onRunErrorEvent: ({ event }: { event: { message?: string } }) => {
        setError(event?.message || "Unknown error");
      },
      // Run threw (e.g. the agent endpoint is unreachable).
      onRunFailed: ({ error }: { error: Error }) => {
        setError(error?.message || String(error));
      },
    });
    return unsubscribe;
  }, [agent]);

  if (!error) return null;

  return (
    <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800 flex items-start gap-3">
      <span aria-hidden="true" className="mt-0.5">
        ⚠️
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-medium">{humanize(error)}</p>
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-red-600/80 hover:text-red-700">
            Technical details
          </summary>
          <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] text-red-700/70 font-mono max-h-32 overflow-auto">
            {error}
          </pre>
        </details>
      </div>
      <button
        type="button"
        onClick={() => setError(null)}
        aria-label="Dismiss"
        className="shrink-0 text-red-400 hover:text-red-600 cursor-pointer"
      >
        ✕
      </button>
    </div>
  );
}

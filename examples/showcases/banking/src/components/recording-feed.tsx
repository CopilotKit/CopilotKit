"use client";

import { useRecording } from "@/components/recording-context";

/**
 * The visible recorder HUD for the self-learning teach-mode UX.
 *
 * While the officer demonstrates how to clear an over-limit charge, this
 * floating panel narrates each UI action as it happens ("Opened the Dashboard",
 * "Filed the policy exception", "Approved the charge") — the concrete signal
 * that the agent is watching and capturing the workflow, not just sitting idle.
 * It reads the same `isRecording` flag as <RecordingVignette/> plus the `steps`
 * feed the call sites push via `logStep`.
 *
 * Presentational only: it shows what was captured but owns no controls — the
 * officer ends the demonstration with "I'm done" on the chat card. Pinned
 * bottom-centre at a z-index above the docked chat panel (which is z-1200) so
 * it stays visible across routes while the officer works on the dashboard.
 */
export function RecordingFeed() {
  const { isRecording, steps } = useRecording();

  if (!isRecording) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Workflow recorder"
      className="recording-feed-panel fixed bottom-6 left-0 right-0 z-[1250] mx-auto w-[330px] max-w-[calc(100vw-2rem)] rounded-2xl border border-brand/30 bg-surface/95 p-4 text-ink shadow-lift ring-1 ring-brand/15 backdrop-blur"
    >
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-negative opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-negative" />
        </span>
        <h3 className="text-sm font-semibold text-ink">
          Recording your workflow
        </h3>
        <span className="ml-auto text-[0.65rem] font-semibold uppercase tracking-wide text-negative">
          Rec
        </span>
      </div>
      <p className="mt-0.5 text-xs text-ink-muted">
        Watching what you do so I can repeat it next time.
      </p>

      <ol className="mt-3 space-y-1.5">
        {steps.length === 0 ? (
          <li className="text-xs italic text-ink-muted">
            Waiting for your first action…
          </li>
        ) : (
          steps.map((step, i) => (
            <li key={step.id} className="flex items-center gap-2.5 text-xs">
              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand-soft text-[0.65rem] font-semibold text-brand-indigo dark:text-brand-violet">
                {i + 1}
              </span>
              <span className="text-ink">{step.label}</span>
            </li>
          ))
        )}
      </ol>
    </div>
  );
}

export default RecordingFeed;

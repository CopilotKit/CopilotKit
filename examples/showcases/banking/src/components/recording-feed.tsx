"use client";

import { useRecording } from "@/components/recording-context";

/**
 * The live recorder feed for the self-learning teach-mode UX, rendered INSIDE
 * the chat (within the `awaitDashboardDemonstration` card) so it reads as a
 * conversation card consistent with the others (e.g. "Save this workflow?"),
 * not a floating overlay.
 *
 * It is its own component (not inlined into the card's render closure) so it
 * subscribes to the recording context directly and re-renders live as each
 * officer action is logged — independent of whether the host HITL card render
 * re-runs (which would otherwise freeze on a stale `steps` snapshot).
 */
export function RecordingSteps() {
  const { steps } = useRecording();

  if (steps.length === 0) {
    return (
      <p className="text-sm italic text-ink-muted">
        Waiting for your first action…
      </p>
    );
  }

  return (
    <ol className="space-y-1.5">
      {steps.map((step, i) => (
        <li key={step.id} className="flex items-center gap-2.5 text-sm">
          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand-soft text-[0.65rem] font-semibold text-brand-indigo dark:text-brand-violet">
            {i + 1}
          </span>
          <span className="text-ink">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

export default RecordingSteps;

"use client";

import { useEffect, useState } from "react";
import { useRecording } from "@/shell/teach";
import { buildDemonstrationDirective } from "@/skins/keel/teach-mode-directives";
import { ChatSurface } from "@/skins/keel/components/chat-surface";

/**
 * BEAT 6 — the live "I'm watching" card, rendered inside `awaitDemonstration`'s
 * interrupt.
 *
 * A component rather than an inline render closure for two reasons, both of which
 * have bitten this app before:
 *
 *  1. IT SUBSCRIBES TO THE RECORDER ITSELF, so each `logStep` re-renders the
 *     feed. A feed read from the host card's closure freezes on the snapshot taken
 *     before the operator touched anything — which is every time.
 *
 *  2. IT OWNS THE OUTER RECORDING BRACKET — `beginRecording()` on mount,
 *     `endRecording()` on unmount. That bracket MUST stay open across the
 *     operator's whole demonstration: filing the variance and then releasing the
 *     revision are two separate clicks in
 *     `components/variance-form.tsx`, each with its own NESTED bracket. Nesting is
 *     fine — the shell's recorder is ref-counted — but if the count reaches zero
 *     between the two clicks the shell clears the feed and STRANDS the
 *     demonstrated code, so `getDemonstratedCode()` then reports null on a
 *     demonstration that plainly happened. Holding it here is what makes the two
 *     clicks read as one recording.
 *
 * No feed reset on mount: the shell's `beginRecording` clears it when it opens a
 * FRESH window and deliberately inherits an already-open one.
 *
 * `ChatSurface` roots it because `useComponent`/HITL renders sit under a
 * `pointer-events: none` wrapper in the transcript — without it the "I'm done"
 * button is drawn and dead.
 */
export function DemonstrationCard({
  onDone,
}: {
  onDone: (summary: string) => void;
}) {
  const { beginRecording, endRecording, steps, getDemonstratedCode } =
    useRecording();
  const [sending, setSending] = useState(false);

  useEffect(() => {
    beginRecording();
    return () => endRecording();
  }, [beginRecording, endRecording]);

  return (
    <ChatSurface className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-negative opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-negative" />
        </span>
        <span className="text-sm text-ink">
          Watching — go ahead and show me.
        </span>
        <span className="ml-auto text-[0.65rem] font-semibold uppercase tracking-wide text-negative">
          Rec
        </span>
      </div>

      {steps.length > 0 ? (
        <ol className="space-y-1 border-l-2 border-brand/30 pl-3">
          {steps.map((step, index) => (
            <li key={step.id} className="text-xs text-ink">
              <span className="mr-1.5 tabular-nums text-ink-muted">
                {index + 1}.
              </span>
              {step.label}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs italic text-ink-muted">Nothing captured yet.</p>
      )}

      <button
        type="button"
        disabled={sending}
        className="self-start rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50"
        onClick={() => {
          // The recorder is the only thing that KNOWS what it caught, so the
          // directive it hands over REPORTS the count and the code; the card that
          // renders the settled result reads them back rather than re-deriving
          // them from the prose. Both halves live in ../teach-mode-directives,
          // held together by a round-trip test.
          //
          // Read BEFORE settling, while this component is still mounted and the
          // bracket is therefore still open — unmounting ends the recording and
          // the shell's minimum-visible hold is the only thing that would keep the
          // feed alive afterwards.
          setSending(true);
          onDone(
            buildDemonstrationDirective({
              steps: steps.map((s) => s.label),
              code: getDemonstratedCode(),
            }),
          );
        }}
      >
        {sending ? "Wrapping up…" : "I'm done"}
      </button>
    </ChatSurface>
  );
}

export default DemonstrationCard;

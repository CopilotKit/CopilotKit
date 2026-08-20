"use client";

import { useEffect, useRef } from "react";
import { useSubagentActivity } from "@/shell/subagents/subagent-activity";

/**
 * The live console for the offsite-expenses run — a CLI window in the
 * transcript showing everything the coding harness does, as it does it.
 *
 * ## It reads EVENTS, not messages
 *
 * An earlier version derived its lines from `agent.messages`, which was wrong in
 * two ways that only a real run exposes: messages materialise at the
 * `MESSAGES_SNAPSHOT` (two per run), so the pane sat still for minutes and then
 * filled all at once at the end; and the persisted messages carry no
 * `subagentRunId`, so there was no way to tell the harness's narration from
 * banking's own. Both are fixed by reading the event stream —
 * `src/shell/subagents/subagent-activity.tsx` owns that subscription and the
 * measurements behind it.
 *
 * ## Everything the harness does lands HERE
 *
 * Deliberately including the prose. The analyst narrates as it works ("The
 * download has a valid CSV header, not an HTML error page — I'll now parse it
 * programmatically…"), and that narration is the most readable thing in the
 * whole run. It used to render as separate chat messages ABOVE a console that
 * was still empty, which read as two disconnected things happening. The chat now
 * declines to render subagent-tagged messages inline (see `chat-panel.tsx`) so
 * this pane is the single place the run is visible.
 *
 * Nested activity is indented: the analyst's own commands sit at one level and
 * its researchers' work one deeper, which is what makes ten concurrent merchant
 * lookups legible as a fan-out rather than a jumble.
 */

/** How close to the tail still counts as "following the run". */
const NEAR_BOTTOM_PX = 40;

const isNearBottom = (el: HTMLDivElement | null): boolean =>
  el === null ||
  el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;

export const HarnessConsole = () => {
  const { lines: allLines, subagents, isRunning } = useSubagentActivity();

  // The report tool renders as the REPORT CARD in the transcript, so drawing it
  // here as well would show the same result twice — once as a terminal line,
  // once as the component it produced.
  const lines = allLines.filter((l) => l.toolName !== "submit_expense_report");

  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * Whether to carry the view to the tail on the next frame.
   *
   * Updated from the SCROLL handler, never during render: reading
   * `scrollRef.current` while rendering inspects the DOM mid-commit, which
   * React's `react-hooks/refs` rule rejects and which under concurrent
   * rendering can read a paint that never happens. Starts `true` so a console
   * nobody has touched follows its run.
   */
  const stick = useRef(true);
  const onScroll = () => {
    stick.current = isNearBottom(scrollRef.current);
  };

  // Follow BOTH a new line and a growing one: text and tool arguments stream as
  // deltas, so the last line keeps getting longer without the count changing.
  // Watching only `lines.length` leaves the view frozen mid-command.
  const tailText = lines.length > 0 ? lines[lines.length - 1].text : "";
  useEffect(() => {
    if (stick.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length, tailText]);

  const running = Array.from(subagents.values()).filter(
    (s) => s.status === "running",
  ).length;

  return (
    <div className="overflow-hidden rounded-[--radius] border border-hairline bg-ink shadow-soft">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-1.5">
        <span className="text-[11px] font-medium tracking-wide text-white/50">
          expense analysis
        </span>
        {isRunning ? (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-white/50">
            <span className="size-1.5 animate-pulse rounded-full bg-positive" />
            {running > 1 ? `${running} agents working` : "running"}
          </span>
        ) : (
          <span className="ml-auto text-[11px] text-white/40">done</span>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        // Bounded height on purpose: a window onto a long run, not a transcript
        // that pushes the report card off the screen.
        className="max-h-80 overflow-y-auto px-3 py-2 font-mono text-[11.5px] leading-relaxed"
      >
        {lines.length === 0 ? (
          <div className="text-white/40">starting…</div>
        ) : (
          lines.map((line) => {
            const pad = line.depth > 0 ? `pl-${line.depth * 3}` : "";
            if (line.kind === "started") {
              return (
                <div key={line.key} className={`py-0.5 text-brand ${pad}`}>
                  ┌ {line.text}
                </div>
              );
            }
            if (line.kind === "text") {
              return (
                <div
                  key={line.key}
                  className={`py-0.5 italic text-white/45 ${pad}`}
                >
                  {line.text}
                </div>
              );
            }
            if (line.kind === "tool") {
              return (
                <div key={line.key} className={`py-0.5 text-white/90 ${pad}`}>
                  {line.text}
                </div>
              );
            }
            return (
              <pre
                key={line.key}
                className={`whitespace-pre-wrap break-all pb-1 ${pad} ${
                  line.failed ? "text-negative" : "text-white/50"
                }`}
              >
                {line.text}
              </pre>
            );
          })
        )}
        {isRunning ? (
          <span className="inline-block h-3 w-1.5 animate-pulse bg-white/70 align-middle" />
        ) : null}
      </div>
    </div>
  );
};

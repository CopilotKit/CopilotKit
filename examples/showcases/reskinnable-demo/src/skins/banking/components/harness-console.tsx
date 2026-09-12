"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSubagentActivity } from "@/shell/subagents/subagent-activity";

/**
 * The live console for the offsite-expenses run — a CLI window in the
 * transcript showing what the coding harness is doing, as it does it.
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
 * ## Closed by default, and a WINDOW when open
 *
 * The pane starts collapsed to its status strip. A run takes tens of seconds and
 * the transcript around it — the report card it produces, the cards above it —
 * is the point of the beat; an always-open terminal streaming for the whole run
 * pushed that off the screen. The strip still carries the live state ("3 agents
 * working"), so the run reads as alive while closed, and one click opens it.
 *
 * Open, it is the FULL log of the run, and deliberately so. The rolling
 * "last two steps" window lives on the transcript's activity lines instead
 * (`src/shell/chat/tool-activity.tsx`) — that is the surface that was growing
 * unboundedly next to the report card. Windowing both left the detail view with
 * two lines in it and nowhere to read the rest, so this pane is the place the
 * whole run stays available, one click away.
 *
 * Nested activity is indented: the analyst's own commands sit at one level and
 * its researchers' work one deeper, which is what makes concurrent merchant
 * lookups legible as a fan-out rather than a jumble.
 *
 * ## Colours come from the SKIN's tokens
 *
 * Every colour here is semantic (`bg-surface-muted`, `text-ink`,
 * `text-ink-muted`, `border-hairline`). It used to be a hardcoded `bg-ink` with
 * `text-white/45`-style overlays — an authentic terminal, and a black slab in
 * the middle of a light-mode transcript. The tokens re-value under
 * `.dark .theme-banking` (see `../theme.css`), so the console now follows the
 * app into either mode with no `dark:` variants of its own.
 */

/** How close to the tail still counts as "following the run". */
const NEAR_BOTTOM_PX = 40;

const isNearBottom = (el: HTMLDivElement | null): boolean =>
  el === null ||
  el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;

export const HarnessConsole = () => {
  const { lines: allLines, subagents, isRunning } = useSubagentActivity();

  const [open, setOpen] = useState(false);

  // The report tool renders as the REPORT CARD in the transcript, so drawing it
  // here as well would show the same result twice — once as a terminal line,
  // once as the component it produced.
  const lines = useMemo(
    () => allLines.filter((l) => l.toolName !== "submit_expense_report"),
    [allLines],
  );

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
  // Watching only the line count leaves the view frozen mid-command.
  //
  // `open` is a dependency because the scroll container does not exist while
  // closed: without it, opening mid-run shows the pane scrolled to the top of
  // the window until the next delta happens to arrive.
  const tailText = lines.length > 0 ? lines[lines.length - 1].text : "";
  useEffect(() => {
    if (stick.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length, tailText, open]);

  const running = Array.from(subagents.values()).filter(
    (s) => s.status === "running",
  ).length;

  return (
    <div className="overflow-hidden rounded-[--radius] border border-hairline bg-surface-muted shadow-soft">
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-hairline/40"
      >
        <span
          aria-hidden
          className={`text-[9px] text-ink-muted transition-transform ${
            open ? "rotate-90" : ""
          }`}
        >
          ▶
        </span>
        <span className="text-[11px] font-medium tracking-wide text-ink-muted">
          expense analysis
        </span>
        {isRunning ? (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-ink-muted">
            <span className="size-1.5 animate-pulse rounded-full bg-positive" />
            {running > 1 ? `${running} agents working` : "running"}
          </span>
        ) : (
          <span className="ml-auto text-[11px] text-ink-muted">done</span>
        )}
      </button>

      {open ? (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          // Bounded height on purpose: a window onto a long run, not a
          // transcript that pushes the report card off the screen.
          className="max-h-80 overflow-y-auto border-t border-hairline px-3 py-2 font-mono text-[11.5px] leading-relaxed"
        >
          {lines.length === 0 ? (
            <div className="text-ink-muted">starting…</div>
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
                    className={`py-0.5 italic text-ink-muted ${pad}`}
                  >
                    {line.text}
                  </div>
                );
              }
              if (line.kind === "tool") {
                return (
                  <div key={line.key} className={`py-0.5 text-ink ${pad}`}>
                    {line.text}
                  </div>
                );
              }
              return (
                <pre
                  key={line.key}
                  className={`whitespace-pre-wrap break-all pb-1 ${pad} ${
                    line.failed ? "text-negative" : "text-ink-muted"
                  }`}
                >
                  {line.text}
                </pre>
              );
            })
          )}
          {isRunning ? (
            <span className="inline-block h-3 w-1.5 animate-pulse bg-ink align-middle" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

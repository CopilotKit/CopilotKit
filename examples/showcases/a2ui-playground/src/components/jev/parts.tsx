"use client";

import "./jev.css";
import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { A2UIMark, CopilotKitKite, CopilotKitWordmark } from "@/components/site/brand";
import { cn } from "@/lib/utils";
import { ms, type JevRunState } from "./use-jev-run";

/** Top bar: CopilotKit × A2UI × TypeSafe, at a size that reads in a video. Nothing else unless a page asks. */
export function JevBar({ right, jev = false }: { right?: React.ReactNode; jev?: boolean }) {
  return (
    <header className="flex h-[72px] flex-none items-center gap-4 border-b border-border px-8">
      <span className="flex items-center gap-2.5 text-foreground">
        <CopilotKitKite className="size-[28px]" />
        <CopilotKitWordmark className="h-[24px] w-auto translate-y-[1px]" />
      </span>
      <span className="text-[22px] font-light text-muted-foreground/60" aria-hidden>
        ×
      </span>
      <span className="flex items-center gap-2 text-foreground">
        <A2UIMark className="size-[30px]" />
        <span className="text-[24px] font-semibold tracking-tight">A2UI</span>
      </span>
      <span className="text-[22px] font-light text-muted-foreground/60" aria-hidden>
        ×
      </span>
      {jev ? (
        // TypeSafe's mark (cropped from the official logo) with the model name.
        <span className="flex items-center gap-2 text-foreground">
          <img src="/brand/typesafe-mark.svg" alt="TypeSafe" className="h-[28px] w-auto" />
          <span className="text-[24px] font-semibold tracking-tight">Jev</span>
        </span>
      ) : (
        // Official TypeSafe AI logo, from typesafe.ai
        <img src="/brand/typesafe-ai.svg" alt="TypeSafe AI" className="h-[27px] w-auto" />
      )}
      {right ? <div className="ml-auto flex items-center gap-3 font-mono text-[13px] text-muted-foreground">{right}</div> : null}
    </header>
  );
}

/** The master loader (transitions.dev matrix dots) while the one Jev call is in flight. */
export function AskingJev({ label = "Asking Jev" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[14px] text-muted-foreground">
      <div className="t-matrix" aria-hidden>
        {Array.from({ length: 16 }, (_, i) => (
          <i key={i} style={{ "--d": ((i % 4) + Math.floor(i / 4)) * 90 } as React.CSSProperties} />
        ))}
      </div>
      <span className="t-shimmer" data-text={label}>
        {label}
      </span>
    </div>
  );
}

/** The one input. Prefilled, Enter runs it. */
export function PromptBar({
  defaultValue,
  onSubmit,
  busy,
  size = "md",
  multiline,
  className,
}: {
  defaultValue: string;
  onSubmit: (v: string) => void;
  busy: boolean;
  size?: "md" | "lg";
  /** Wraps onto two lines (narrow columns). Enter still runs it. */
  multiline?: boolean;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <form
      className={cn("jev-prompt flex gap-3", multiline ? "items-end py-3 pl-5 pr-2.5" : "items-center", !multiline && (size === "lg" ? "h-16 pl-6 pr-3" : "h-14 pl-5 pr-2.5"), className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) onSubmit(value);
      }}
    >
      {multiline ? (
        <textarea
          ref={ref}
          rows={1}
          style={{ fieldSizing: "content" } as React.CSSProperties}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!busy) onSubmit(value);
            }
          }}
          aria-label="Request"
          spellCheck={false}
          className="min-w-0 flex-1 resize-none bg-transparent text-[17px] leading-[1.45] text-foreground outline-none"
        />
      ) : (
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Request"
        spellCheck={false}
        className={cn("min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground", size === "lg" ? "text-[19px]" : "text-[16px]")}
      />
      )}
      <button type="submit" aria-label="Run" disabled={busy} className={cn("jev-run grid flex-none place-items-center rounded-full", size === "lg" ? "size-10" : "size-9")}>
        {busy ? <span className="jev-spin" aria-hidden /> : <ArrowUp className="size-4" />}
      </button>
    </form>
  );
}

export type Breakdown = { placesMs?: number; placesCached?: boolean; jevMs?: number; renderMs?: number; totalMs?: number };

/** The run as measured: server place lookup, server Jev round trip, A2UI render in the browser, total. */
export function BreakdownLine({ b, source, className }: { b: Breakdown; source?: string; className?: string }) {
  const parts: Array<[string, string]> = [];
  if (b.placesMs != null) parts.push(["Places", `${ms(b.placesMs)}${b.placesCached ? " cached" : ""}`]);
  if (b.jevMs != null) parts.push(["Jev", ms(b.jevMs)]);
  if (b.renderMs != null) parts.push(["A2UI render", ms(b.renderMs)]);
  if (b.totalMs != null) parts.push(["total", ms(b.totalMs)]);
  return (
    <div className={cn("jev-timing flex flex-wrap items-center gap-x-2.5 gap-y-1 whitespace-nowrap font-mono tabular-nums", className)}>
      {parts.map(([k, v], i) => (
        <span key={k} className="jev-row-in flex items-center gap-2.5" style={{ animationDelay: `${i * 60}ms` }}>
          {i ? <span className="text-muted-foreground/50">·</span> : null}
          <span className="text-muted-foreground">{k}</span>
          <span className="text-foreground">{v}</span>
        </span>
      ))}
      {source ? <SourceTag source={source} /> : null}
    </div>
  );
}

/** The same breakdown as equal cells (label over value): no separators, never wraps mid-line. */
export function BreakdownGrid({ b, className }: { b: Breakdown; className?: string }) {
  const cells: Array<[string, string | null]> = [];
  if (b.placesMs !== undefined || b.placesCached) cells.push(["Places", b.placesMs != null ? `${ms(b.placesMs)}${b.placesCached ? " cached" : ""}` : null]);
  if (b.jevMs !== undefined) cells.push(["Jev", b.jevMs != null ? ms(b.jevMs) : null]);
  cells.push(["A2UI render", b.renderMs != null ? ms(b.renderMs) : null]);
  cells.push(["Total", b.totalMs != null ? ms(b.totalMs) : null]);
  return (
    <div className={cn("grid gap-3", className)} style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
      {cells.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <p className="truncate text-[12px] text-muted-foreground">{k}</p>
          <p className="mt-1 whitespace-nowrap font-mono text-[16px] tabular-nums text-foreground">{v ?? <span className="text-muted-foreground/30">000 ms</span>}</p>
        </div>
      ))}
    </div>
  );
}

/** Breakdown for a run in this page's state. */
export function breakdownOf(state: JevRunState): Breakdown | null {
  if (state.phase === "painting" || state.phase === "done") {
    const r = state.result;
    return {
      placesMs: r.places?.ms,
      placesCached: r.places?.cached,
      jevMs: r.jevMs,
      renderMs: state.phase === "done" ? state.renderedMs - state.responseMs : undefined,
      totalMs: state.phase === "done" ? state.renderedMs : undefined,
    };
  }
  if (state.phase === "notice") return { placesMs: state.notice.places?.ms, totalMs: state.responseMs };
  return null;
}

/** The timing line on every version. While a run is in flight the clock ticks. */
export function Timing({ state, className }: { state: JevRunState; className?: string }) {
  const elapsed = useElapsed(state.phase === "running" ? state.startedAt : null);
  const b = breakdownOf(state);
  return (
    <div className={cn("flex items-center gap-2.5 font-mono tabular-nums", className)} aria-live="polite">
      {state.phase === "idle" ? (
        <span className="text-muted-foreground">Press Enter to ask Jev</span>
      ) : state.phase === "error" ? (
        <span className="text-[oklch(0.75_0.15_25)]">{state.message}</span>
      ) : state.phase === "running" ? (
        <>
          <Dot pulse />
          <span className="text-foreground">{ms(elapsed)}</span>
        </>
      ) : b ? (
        <>
          <Dot />
          <BreakdownLine b={b} source={state.phase === "notice" ? undefined : state.result.source} />
        </>
      ) : null}
    </div>
  );
}

/** Live runs show nothing extra; a `?fixture=1` replay of a saved run is marked so it is never mistaken for one. */
export function SourceTag({ source }: { source: string }) {
  if (source === "live") return null;
  return <span className="jev-tag">replay</span>;
}

export function Dot({ pulse }: { pulse?: boolean }) {
  return <span className={cn("jev-dot", pulse && "jev-dot-pulse")} aria-hidden />;
}

export function useElapsed(since: number | null) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (since == null) return;
    let raf = 0;
    const tick = () => {
      setNow(performance.now() - since);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [since]);
  return since == null ? 0 : now;
}

/** Human labels for the prepared layouts, shown next to Jev's choice. */
export const LAYOUT_LABEL: Record<string, string> = {
  map_list: "List and map",
  compare: "Comparison table",
  single: "Single pick",
  compare_table: "Comparison table",
  cards: "Product cards",
  table: "Full table",
  month_bar: "This month by category",
  trend_area: "Stacked trend",
  focus_line: "One line per category",
};

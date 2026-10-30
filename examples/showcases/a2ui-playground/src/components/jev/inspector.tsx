"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { JsonView } from "@/components/app/json-view";
import { USE_CASES, type UseCaseId } from "@/jev/usecases";
import { cn } from "@/lib/utils";
import { LAYOUT_LABEL } from "./parts";
import { ms, type JevEvent, type JevResult, type JevRunState } from "./use-jev-run";

/** transitions.dev tabs sliding (the playground inspector's tabs). */
export function SlidingTabs<T extends string>({ tabs, tab, onChange }: { tabs: Array<[T, string]>; tab: T; onChange: (t: T) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = bar.current?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
    if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
  }, [tab]);
  return (
    <div ref={bar} role="tablist" className="t-tabs">
      <span className="t-tabs-pill" style={pill ? { width: pill.w, transform: `translateX(${pill.x}px)` } : undefined} aria-hidden />
      {tabs.map(([t, label]) => (
        <button key={t} data-tab={t} role="tab" aria-selected={tab === t} onClick={() => onChange(t)} className="t-tab text-[15px] font-medium">
          {label}
        </button>
      ))}
    </div>
  );
}

/** Jev's two kinds of answers: which prepared layout, and how well each candidate fits. */
export function Decision({ usecase, result, busy }: { usecase: UseCaseId; result: JevResult | null; busy: boolean }) {
  const uc = USE_CASES[usecase];
  const layouts = Object.keys(uc.layouts);
  const rows: Array<{ id: string; name: string; fit: number }> = result?.ranked ?? ("candidates" in uc ? uc.candidates.map((c) => ({ ...c, fit: 0 })) : []);
  const noun = usecase === "cafes" ? "café" : usecase === "spending" ? "category" : "laptop";
  const k = result?.surfaceId ?? "idle";
  return (
    <div className="flex flex-col gap-7">
      <section>
        <Label left="Layout" right={`${layouts.length} prepared`} />
        <p className="-mt-1 mb-3 text-[13px] text-muted-foreground">Which prepared view Jev picked, with its probability.</p>
        <ul className="flex flex-col gap-1">
          {layouts.map((l, i) => {
            const picked = result?.layout === l;
            const p = result?.layoutProbabilities[l];
            return (
              <li
                key={`${l}-${k}`}
                className={cn(
                  "jev-row-in flex items-center gap-3 rounded-lg border px-3 py-2 text-[15px]",
                  picked ? "border-[oklch(0.72_0.17_292/45%)] bg-[var(--jev-accent-soft)] text-foreground" : "border-transparent text-muted-foreground",
                )}
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <span className={cn("grid size-4 flex-none place-items-center rounded-full", picked ? "bg-[var(--jev-accent)] text-background" : "border border-[var(--jev-line-strong)]")}>
                  {picked ? <Check className="size-3" strokeWidth={3} /> : null}
                </span>
                <span className="flex-1">{LAYOUT_LABEL[l] ?? l}</span>
                <span className="font-mono text-[13px] tabular-nums">{p != null ? `${Math.round(p * 100)}%` : busy ? "..." : ""}</span>
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <Label left={usecase === "spending" ? "Focus" : "Fit"} right={rows.length ? `${rows.length} scored` : undefined} />
        <p className="-mt-1 mb-3 text-[13px] text-muted-foreground">{usecase === "spending" ? "How much Jev says to look at each category. The top one is highlighted." : `Jev's score for each ${noun}. It sets the order.`}</p>
        {!rows.length ? <p className="font-mono text-[13px] text-muted-foreground/70">{busy ? "Looking up real cafés..." : "Real cafés appear after the lookup."}</p> : null}
        <ul className="flex flex-col gap-2.5">
          {rows.map((r, i) => (
            <li key={`${r.id}-${k}`} className="jev-row-in grid grid-cols-[18px_minmax(0,1fr)_112px_44px] items-center gap-3 text-[14.5px]" style={{ animationDelay: `${100 + i * 40}ms` }}>
              <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{result ? i + 1 : ""}</span>
              <span className={cn("truncate", result ? (i === 0 ? "text-foreground" : "text-foreground/80") : "text-muted-foreground")}>{r.name}</span>
              <span className="jev-bar-track">{result ? <span className="jev-bar block" data-dim={i > 2} style={{ width: `${Math.max(2, r.fit)}%`, animationDelay: `${120 + i * 40}ms` }} /> : null}</span>
              <span className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">{result ? `${r.fit}%` : ""}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function Label({ left, right }: { left: string; right?: string }) {
  return (
    <h3 className="mb-2.5 flex items-baseline justify-between font-mono text-[12.5px] uppercase tracking-[0.06em] text-muted-foreground">
      <span>{left}</span>
      {right ? <span className="normal-case tracking-normal">{right}</span> : null}
    </h3>
  );
}

/** Real timeline of one run, in ms from Enter. */
export function Stream({ state }: { state: JevRunState }) {
  const rows = useMemo(() => {
    if (state.phase === "idle" || state.phase === "error") return [];
    const out: Array<{ t: number | null; label: string; detail?: string }> = [{ t: 0, label: "Request sent" }];
    if (state.phase === "running") return out;
    if (state.phase === "notice") {
      if (state.notice.places) out.push({ t: state.notice.places.ms, label: "Place lookup", detail: state.notice.places.city });
      out.push({ t: state.responseMs, label: state.notice.notice });
      return out;
    }
    const r = state.result;
    if (r.places) out.push({ t: r.places.ms, label: `Found ${r.places.count} cafés`, detail: `${r.places.city}, ${r.places.source}` });
    out.push({ t: (r.places?.ms ?? 0) + r.jevMs, label: `Jev answered ${r.questionCount} questions`, detail: `${r.jevMs} ms` });
    const p = r.layoutProbabilities[r.layout];
    out.push({ t: null, label: `Layout ${LAYOUT_LABEL[r.layout] ?? r.layout}`, detail: p != null ? `${Math.round(p * 100)}%` : undefined });
    out.push({ t: null, label: `Ranked ${r.ranked.length}`, detail: r.ranked[0]?.name });
    out.push({ t: state.responseMs, label: `${r.ops.length} A2UI operations`, detail: `${r.componentCount} component${r.componentCount === 1 ? "" : "s"}` });
    if (state.phase === "done") out.push({ t: state.renderedMs, label: "Surface rendered" });
    return out;
  }, [state]);
  if (!rows.length) return <p className="font-mono text-[14px] text-muted-foreground">Nothing sent yet.</p>;
  return (
    <ol className="flex flex-col font-mono text-[14px] leading-[2]">
      {rows.map((e, i) => (
        <li key={i} className="jev-row-in grid grid-cols-[76px_minmax(0,1fr)] gap-3" style={{ animationDelay: `${i * 50}ms` }}>
          <span className="tabular-nums text-muted-foreground">{e.t != null ? ms(e.t) : ""}</span>
          <span className="min-w-0 truncate">
            <span className="text-foreground/90">{e.label}</span>
            {e.detail ? <span className="text-muted-foreground"> {e.detail}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Live run log: each server step the moment its line arrives on the stream (t = ms since the request reached the
 * server), then the browser's own "Surface rendered" (t = ms since Enter). Nothing here is paced or invented.
 */
export function LiveStream({ events, state }: { events: JevEvent[]; state: JevRunState }) {
  const rows: Array<{ key: string; t: number; label: string; detail?: string; where: "server" | "browser" }> = events.map((e, i) => ({
    key: `${i}-${e.kind}`,
    t: e.t,
    label: e.layout ? `Layout ${LAYOUT_LABEL[e.layout] ?? e.layout}` : e.label,
    detail: e.detail,
    where: "server",
  }));
  if (state.phase === "done") rows.push({ key: "rendered", t: state.renderedMs, label: "Surface rendered", detail: `render ${ms(state.renderedMs - state.responseMs)}`, where: "browser" });
  if (state.phase === "error") rows.push({ key: "error", t: 0, label: state.message, where: "browser" });
  const waiting = state.phase === "running" || state.phase === "painting";
  if (!rows.length && !waiting) return <p className="font-mono text-[14px] text-muted-foreground">Nothing sent yet.</p>;
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col font-mono text-[14px] leading-[2]">
        {rows.map((e) => (
          <li key={e.key} className="jev-row-in grid grid-cols-[64px_minmax(0,1fr)_52px] gap-3">
            <span className="tabular-nums text-muted-foreground">{ms(e.t)}</span>
            <span className="min-w-0 truncate">
              <span className="text-foreground/90">{e.label}</span>
              {e.detail ? <span className="text-muted-foreground"> {e.detail}</span> : null}
            </span>
            <span className="text-right text-[11.5px] text-muted-foreground/60">{e.where}</span>
          </li>
        ))}
      </ol>
      {waiting ? (
        <p className="flex items-center gap-2 font-mono text-[13px] text-muted-foreground">
          <span className="jev-dot jev-dot-pulse" aria-hidden />
          {state.phase === "painting" ? "Rendering" : "Waiting for the next step"}
        </p>
      ) : null}
    </div>
  );
}

export function Json({ result }: { result: JevResult | null }) {
  if (!result) return <p className="font-mono text-[14px] text-muted-foreground">No operations yet.</p>;
  return <JsonView value={result.ops} />;
}

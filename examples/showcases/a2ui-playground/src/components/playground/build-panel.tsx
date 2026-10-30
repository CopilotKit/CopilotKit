"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useMode } from "@/components/app/providers";
import { modelLabel } from "@/lib/model-options";
import { cn } from "@/lib/utils";
import { nodeElements } from "@/lib/node-rects";
import { latestComponents, runStore, useRunStore, type RunRecord, type SurfaceRecord } from "@/lib/run-store";
import { kChars } from "./lines";

/* ───────────────────────── measured parts ───────────────────────── */

type Rect = { x: number; y: number; w: number; h: number };
type Part = { id: string; type: string; state: "pending" | "streaming" | "ok"; rect?: Rect };

const CONTAINERS = new Set(["Column", "Row", "Grid", "Card", "Section", "List", "Tabs"]);

/**
 * Reads real DOM rects for the A2UI nodes of a surface (see `nodeElements`),
 * relative to the surface host. Polls while a run is building, settles once
 * it is done.
 */
function useMeasuredRects(surfaceKey: string | null, live: boolean) {
  const [rects, setRects] = useState<{ root: Rect | null; byId: Record<string, Rect> }>({ root: null, byId: {} });
  useEffect(() => {
    if (!surfaceKey) return;
    let raf = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const measure = () => {
      const host = document.querySelector(`[data-surface-key="${CSS.escape(surfaceKey)}"]`);
      const ops = runStore.get().surfaces[surfaceKey]?.ops;
      if (!host || !ops) return;
      const r0 = host.getBoundingClientRect();
      const byId: Record<string, Rect> = {};
      for (const [id, n] of nodeElements(host, ops)) {
        const el = n.firstElementChild as HTMLElement | null;
        if (!el) continue;
        const r = el.getBoundingClientRect();
        byId[id] = { x: Math.round(r.left - r0.left), y: Math.round(r.top - r0.top), w: Math.round(r.width), h: Math.round(r.height) };
      }
      setRects({ root: { x: 0, y: 0, w: Math.round(r0.width), h: Math.round(r0.height) }, byId });
    };
    raf = requestAnimationFrame(measure);
    if (live) timer = setInterval(measure, 160);
    const settle = setTimeout(measure, 700);
    return () => {
      cancelAnimationFrame(raf);
      if (timer) clearInterval(timer);
      clearTimeout(settle);
    };
  }, [surfaceKey, live]);
  return rects;
}

function partsOf(surface: SurfaceRecord | undefined, run: RunRecord | undefined, rects: Record<string, Rect>): Part[] {
  if (!surface) return [];
  return latestComponents(surface.ops).map((c) => {
    const blue = c.component === "Blueprint";
    const of = blue ? String(c.of ?? "") : c.component;
    const state: Part["state"] = !blue ? "ok" : run?.status === "running" && run.openId === c.id ? "streaming" : "pending";
    return { id: c.id, type: of.startsWith("#") ? "pending" : of, state, rect: rects[c.id] };
  });
}

const pad = (n: number, w = 3) => String(Math.max(0, n)).padStart(w, "0");
const fmt = (ms: number | null | undefined) => (ms == null ? "..." : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`);

function bar(p: Part, chars: number) {
  if (p.state === "ok") return "[  ok  ]";
  if (p.state === "pending") return "[......]";
  const filled = Math.min(5, Math.max(1, Math.round((chars / 360) * 6)));
  return `[${"#".repeat(filled)}${".".repeat(6 - filled)}]`;
}

/**
 * Whether the chat is still painting the run's surface (its reveal runs on
 * after the agent's stream ends; see `data-build` in surface-renderer.tsx),
 * and, when this panel saw it finish, at what time since the prompt.
 */
function useChatPaint(run: RunRecord | undefined) {
  const [state, setState] = useState<{ runId: string; painting: boolean; onScreenMs: number | null } | null>(null);
  const runId = run?.id;
  const key = run?.surfaceKey ?? null;
  const ended = !!run && run.status !== "running";
  const startedAt = run?.startedAt ?? 0;
  useEffect(() => {
    if (!runId || !key || !ended) return;
    let saw = false;
    let ticks = 0;
    const check = () => {
      // Give up after 10 s rather than claim it is still painting.
      const painting = ++ticks < 100 && document.querySelector(`[data-surface-key="${CSS.escape(key)}"]`)?.getAttribute("data-build") === "building";
      if (painting) saw = true;
      setState({ runId, painting, onScreenMs: !painting && saw ? Math.round(performance.now() - startedAt) : null });
      return !painting;
    };
    if (check()) return;
    const timer = setInterval(() => check() && clearInterval(timer), 100);
    return () => clearInterval(timer);
  }, [runId, key, ended, startedAt]);
  return state?.runId === runId ? state : null;
}

const PATH_LABEL: Record<string, string> = { fixed: "Pre-built template", dynamic: "Composed by the model", text: "Text reply" };
const STATUS_LABEL: Record<string, string> = { running: "building", done: "agent done", error: "failed" };

/* ───────────────────────── the panel ───────────────────────── */

/**
 * `runId`: the run to show (the latest when left out). `null`: the answer on screen has no run in this
 * visit (it came back with the chat from an earlier one), so there are no timings to show.
 */
export function BuildPanel({ runId }: { runId?: string | null } = {}) {
  const runs = useRunStore((s) => s.runs);
  const run = runId === undefined ? runs[runs.length - 1] : runId ? runs.find((r) => r.id === runId) : undefined;
  const surfaceKey = run?.surfaceKey ?? null;
  const surface = useRunStore((s) => (surfaceKey ? s.surfaces[surfaceKey] : undefined));
  const running = run?.status === "running";
  const { root, byId } = useMeasuredRects(surfaceKey, running);
  const parts = useMemo(() => partsOf(surface, run, byId), [surface, run, byId]);
  const done = parts.filter((p) => p.state === "ok").length;
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(t);
  }, [running]);
  const elapsed = run ? (running ? Math.round(now - run.startedAt) : run.totalMs) : null;
  const paint = useChatPaint(run);
  const painting = !running && !!paint?.painting;
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (running) setOpen(true);
    else if (run?.status === "done") {
      const t = setTimeout(() => setOpen(false), 1600);
      return () => clearTimeout(t);
    }
  }, [running, run?.status, run?.id]);

  if (!run) {
    return (
      <div className="flex h-full flex-col gap-6 p-6">
        <Models />
        <div className="pg-dots flex h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--pg-line)] text-center">
          <MatrixDots idle />
          <p className="text-[15px] font-medium text-foreground/90">{runId === null ? "No timings for this answer" : "No run yet"}</p>
          <p className="px-4 font-mono text-[13px] text-muted-foreground">{runId === null ? "timings are kept for runs since this page opened" : "timings and components show up here"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="@container flex-none space-y-4 border-b border-[var(--pg-line)] p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[16px] font-medium">{run.prompt}</p>
            <p className="mt-1 font-mono text-[13px] text-muted-foreground">
              {run.path ? (PATH_LABEL[run.path] ?? run.path) : "Picking a tool"}
              {run.tool ? `, ${run.tool}` : ""}
            </p>
          </div>
          <span
            className={cn("flex flex-none items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[12.5px]", running || painting ? "border-amber-400/30 text-amber-200" : "border-[var(--pg-line)] text-muted-foreground")}
          >
            {running || painting ? <MatrixDots /> : run.status === "done" ? <SuccessCheck key={run.id} /> : null}
            {painting ? "painting" : (STATUS_LABEL[run.status] ?? run.status)}
          </span>
        </div>
        <PathView run={run} />
        <div className="grid grid-cols-3 gap-2">
          <Metric label="First frame" value={fmt(run.firstFrameMs)} note="placeholder layout" />
          <Metric label="First content" value={fmt(run.firstPaintMs)} note="first real component" accent={run.path} />
          <Metric
            label={running ? "Elapsed" : "Agent done"}
            value={fmt(elapsed)}
            note={running ? "since the prompt" : painting ? "chat still painting" : paint?.onScreenMs ? `on screen at ${fmt(paint.onScreenMs)}` : "agent's stream ended"}
          />
        </div>
        <PayloadCard run={run} runs={runs} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex flex-none items-center justify-between px-6 py-3.5 font-mono text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <span>
            Components written {pad(done, 2)}/{pad(parts.length, 2)}
          </span>
          <span className="flex items-center gap-1.5">
            {open ? "hide list" : "show list"}
            <ChevronDown className={cn("size-3.5 transition-transform duration-300", open && "rotate-180")} />
          </span>
        </button>
        <BlueprintMap root={root} parts={parts} />
        <div className={cn("grid min-h-0 flex-1 transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
          <div className="flex min-h-0 flex-col overflow-hidden">
            <ol className="min-h-0 flex-1 overflow-y-auto px-6 pb-3 font-mono text-[13.5px] leading-[1.85]">
              {parts.map((p) => (
                <li key={p.id} className={cn("grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_76px_80px_auto] gap-2.5", p.state === "ok" ? "text-foreground/80" : "text-[var(--pg-faint)]")}>
                  <span className="truncate">{p.id}</span>
                  <span className={cn("truncate", p.state === "streaming" && "text-amber-200")}>{p.type}</span>
                  <span className="tabular-nums">{p.rect ? `${pad(p.rect.x)},${pad(p.rect.y)}` : "---,---"}</span>
                  <span className="tabular-nums">{p.rect ? `${p.rect.w}×${p.rect.h}` : "--×--"}</span>
                  <span className={cn(p.state === "ok" && "text-[var(--pg-fixed)]")}>{bar(p, run.openChars)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="flex flex-none flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[var(--pg-line)] px-6 py-3 font-mono text-[13px] text-muted-foreground">
          <span>{run.tps ? `${run.tps} tokens/s` : run.payload ? `${kChars(run.payload.outputChars)} characters written` : run.path === "fixed" ? "Template, nothing written" : ""}</span>
          <span>{run.tokens ? `${run.tokens} tokens` : `${parts.length} components`}</span>
          <span>{running ? `Building ${fmt(elapsed)}` : painting ? "Chat still painting" : `${run.status === "done" ? "Agent done" : (STATUS_LABEL[run.status] ?? run.status)} ${fmt(elapsed)}`}</span>
        </div>
        <div className="flex-none border-t border-[var(--pg-line)] px-6 py-4">
          <Models run={run} />
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── pieces ───────────────────────── */

/** One timing. `note` says what it measures. */
function Metric({ label, value, note, accent }: { label: string; value: string; note: string; accent?: string | null }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--pg-line)] px-3.5 py-2.5">
      <div className="text-[12.5px] text-muted-foreground">{label}</div>
      <div
        className="mt-1 whitespace-nowrap font-mono text-[18px] font-medium leading-none tabular-nums @[400px]:text-[22px]"
        style={{ color: accent === "fixed" ? "var(--pg-fixed)" : accent === "dynamic" ? "var(--pg-dynamic)" : undefined }}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11.5px] leading-snug text-[var(--pg-faint)]">{note}</div>
    </div>
  );
}

function PathView({ run }: { run: RunRecord }) {
  const at = (pred: (label: string, kind: string) => boolean) => run.events.find((e) => pred(e.label, e.kind))?.t ?? null;
  const routed = at((_l, k) => k === "tool");
  const lane = run.path;
  const steps: Array<{ label: string; ms: number | null; on: boolean; tone?: "fixed" | "dynamic" }> = [
    { label: "Pick a tool", ms: routed, on: routed != null },
    lane === "fixed"
      ? { label: "Template", ms: at((_l, k) => k === "skeleton"), on: true, tone: "fixed" }
      : { label: "Write the UI", ms: at((_l, k) => k === "compose"), on: lane === "dynamic", tone: "dynamic" },
    lane === "fixed"
      ? { label: "Fill in data", ms: run.firstPaintMs, on: run.firstPaintMs != null, tone: "fixed" }
      : { label: "Validate", ms: at((_l, k) => k === "validate"), on: at((_l, k) => k === "validate") != null, tone: "dynamic" },
    { label: "Agent done", ms: run.totalMs, on: run.totalMs != null },
  ];
  return (
    // Four steps in a row when the panel has room, two by two in a phone drawer.
    <ol className="grid grid-cols-2 gap-1.5 @[400px]:flex @[400px]:items-center">
      {steps.map((s, i) => (
        <li key={i} className="flex min-w-0 flex-1 items-center gap-1.5">
          <span
            className={cn("flex min-w-0 flex-1 flex-col rounded-md border px-2.5 py-2 transition-colors duration-300", s.on ? "border-transparent" : "border-dashed border-[var(--pg-line)]")}
            style={s.on ? { background: `color-mix(in oklch, ${s.tone === "fixed" ? "var(--pg-fixed)" : s.tone === "dynamic" ? "var(--pg-dynamic)" : "var(--pg-text)"} 10%, transparent)` } : undefined}
          >
            <span className={cn("truncate text-[13px] font-medium", !s.on && "text-muted-foreground")}>{s.label}</span>
            <span className="font-mono text-[12.5px] tabular-nums text-muted-foreground">{s.ms != null ? fmt(s.ms) : "..."}</span>
          </span>
          {i < steps.length - 1 ? <span className="hidden h-px w-2 flex-none bg-[var(--pg-line-strong)] @[400px]:block" /> : null}
        </li>
      ))}
    </ol>
  );
}

/** A dotted canvas with every part drawn as its measured rectangle, scaled to fit. */
function BlueprintMap({ root, parts }: { root: Rect | null; parts: Part[] }) {
  const W = 452;
  const H = 210;
  if (!root || !root.w) return <div className="mx-6 mb-3 h-[210px] flex-none rounded-lg border border-dashed border-[var(--pg-line)] pg-dots" />;
  const s = Math.min((W - 24) / root.w, (H - 24) / Math.max(root.h, 1));
  const ox = (W - root.w * s) / 2;
  const oy = 12;
  return (
    <div className="pg-dots relative mx-6 mb-3 flex-none overflow-hidden rounded-lg border border-[var(--pg-line)]" style={{ height: H }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full">
        <rect x={ox} y={oy} width={root.w * s} height={root.h * s} rx={6} fill="none" stroke="var(--gen-line)" strokeDasharray="2 3" />
        <text x={ox} y={oy - 3} className="fill-[var(--pg-faint)] font-mono text-[8px]">
          {root.w}×{root.h}
        </text>
        {parts.map((p) => {
          if (!p.rect || !p.rect.w || CONTAINERS.has(p.type)) return null;
          const x = ox + p.rect.x * s;
          const y = oy + p.rect.y * s;
          const w = p.rect.w * s;
          const h = Math.max(2, p.rect.h * s);
          const color = p.state === "ok" ? "var(--pg-fixed)" : p.state === "streaming" ? "var(--pg-dynamic)" : "var(--gen-line)";
          return (
            <g key={p.id} className="pg-map-part t-skel-in">
              <rect x={x} y={y} width={w} height={h} rx={3} fill={p.state === "ok" ? "color-mix(in oklch, var(--pg-fixed) 10%, transparent)" : "none"} stroke={color} strokeDasharray={p.state === "ok" ? undefined : "2 2"} strokeWidth={0.8} />
              {w > 60 && h > 14 ? (
                <text x={x + 4} y={y + 9} className="font-mono text-[7px]" fill={color}>
                  {p.type} {p.rect.w}×{p.rect.h}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** The models and format of the run, or of the next run before there is one. */
function Models({ run }: { run?: RunRecord }) {
  const { model, format } = useMode();
  const chips = run?.router
    ? run.path === "fixed"
      ? [`picks the tool: ${run.router}`, "pre-built template"]
      : [`picks the tool: ${run.router}`, `writes the UI: ${run.composer}`, run.format === "json" ? "A2UI JSON" : "A2UI Express"]
    : [modelLabel(model), format === "json" ? "A2UI JSON" : "A2UI Express"];
  return (
    <div className="flex flex-wrap items-center gap-1.5 font-mono text-[12.5px] text-muted-foreground">
      {[...chips, "A2UI v1.0"].map((c) => (
        <span key={c} className="rounded-md border border-[var(--pg-line)] px-1.5 py-0.5">
          {c}
        </span>
      ))}
    </div>
  );
}

/**
 * What the surface cost to write: the same surface in Express and in JSON
 * (whichever the model wrote, the other is computed), what went on the wire
 * after macros expanded, and the composed runs so far side by side.
 */
function PayloadCard({ run, runs }: { run: RunRecord; runs: RunRecord[] }) {
  const p = run.payload;
  const history = runs.filter((r) => r.payload).slice(-5);
  if (!p) return null;
  const max = Math.max(p.expressChars, p.jsonChars, 1);
  // Measured on this surface: the same components written both ways.
  const ratio = p.expressChars && p.jsonChars ? p.jsonChars / p.expressChars : null;
  const compare = ratio == null ? null : ratio >= 1.05 ? `${ratio.toFixed(1)}x smaller in Express` : ratio <= 0.95 ? `${(1 / ratio).toFixed(1)}x larger in Express` : "about the same size";
  const bars: Array<["express" | "json", string, number]> = [
    ["express", "Express", p.expressChars],
    ["json", "JSON", p.jsonChars],
  ];
  return (
    <div data-payload className="space-y-2.5 rounded-lg border border-[var(--pg-line)] px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-2 text-[12.5px] text-muted-foreground">
        <span>
          Payload, written as <span className="text-foreground">{p.format === "express" ? "Express" : "JSON"}</span>
        </span>
        {compare ? <span className="font-mono text-foreground">{compare}</span> : null}
      </div>
      <div className="space-y-1.5">
        {bars.map(([id, label, n]) => (
          <div key={id} className="grid grid-cols-[64px_minmax(0,1fr)_56px] items-center gap-2 font-mono text-[12px]">
            <span className={cn(p.format === id ? "text-foreground" : "text-muted-foreground")}>{label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-[var(--pg-line)]">
              <span
                className="block h-full rounded-full transition-[width] duration-500"
                style={{ width: `${(n / max) * 100}%`, background: p.format === id ? "var(--pg-dynamic)" : "color-mix(in oklch, var(--pg-text) 30%, transparent)" }}
              />
            </span>
            <span className="text-right tabular-nums text-muted-foreground">{n ? `${kChars(n)} ch` : "n/a"}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[12px] text-muted-foreground">
        <span>composed in {fmt(p.composeMs)}</span>
        {p.firstTokenMs != null ? <span>first token {fmt(p.firstTokenMs)}</span> : null}
        {p.macros ? (
          <span>
            {p.macros} macro{p.macros > 1 ? "s" : ""}, {kChars(p.wireChars)} ch on the wire
          </span>
        ) : null}
      </div>
      {history.length > 1 ? (
        <div className="@container">
          <table className="w-full font-mono text-[12px] text-muted-foreground" data-payload-runs>
            <caption className="sr-only">Composed runs so far, newest last</caption>
            <thead>
              <tr className="text-left text-[11px] text-[var(--pg-faint)]">
                <th scope="col" className="pb-1 pr-2 font-normal">Prompt</th>
                <th scope="col" className="pb-1 pr-2 font-normal">Format</th>
                <th scope="col" className="pb-1 pr-2 font-normal @max-[360px]:hidden">Model</th>
                <th scope="col" className="pb-1 pr-2 text-right font-normal">Written</th>
                <th scope="col" className="pb-1 text-right font-normal">Took</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id} className={cn(r.id === run.id && "text-foreground")}>
                  <td className="w-full max-w-0 truncate py-0.5 pr-2 font-sans text-[12.5px]" title={r.prompt}>
                    {r.prompt}
                  </td>
                  <td className="whitespace-nowrap pr-2">{r.payload!.format === "express" ? "Express" : "JSON"}</td>
                  <td className="whitespace-nowrap pr-2 @max-[360px]:hidden">{modelLabel(r.model)}</td>
                  <td className="whitespace-nowrap pr-2 text-right tabular-nums">{kChars(r.payload!.outputChars)} ch</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{fmt(r.payload!.composeMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** transitions.dev matrix dot loader (4x4). */
function MatrixDots({ idle }: { idle?: boolean }) {
  return (
    <span className={cn("t-matrix flex-none", idle && "opacity-60")} aria-hidden>
      {Array.from({ length: 16 }, (_, i) => (
        <i key={i} style={{ "--d": ((i % 4) + Math.floor(i / 4)) * 90 } as React.CSSProperties} />
      ))}
    </span>
  );
}

/** transitions.dev success check, played once when a run finishes. */
function SuccessCheck() {
  return (
    <span className="t-success-check text-[var(--pg-fixed)]" data-state="in" style={{ "--check-y-amount": "6px", "--check-blur-from": "3px" } as React.CSSProperties} aria-hidden>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2.5 6.2 5 8.5 9.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

"use client";

import "./build-page.css";
import "./build-motion.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { StaticSurface } from "@/components/app/static-surface";
import { useUIGeneration } from "@/components/app/use-ui-generation";
import { present } from "@/lib/build-timeline";
import { nodeElements } from "@/lib/node-rects";
import { fillRecipe } from "./recipes";
import type { Recipe, RecordedRun } from "./types";

const SPEEDS = [0.25, 0.5, 1] as const;
const LEAD_IN = 1200; // start this long before the first frame: the tail of the real wait
const HOLD = 3200; // pause on the finished surface before looping

type Rect = { x: number; y: number; w: number; h: number };

function readParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function BuildStudio({ runs, recipes }: { runs: RecordedRun[]; recipes: Recipe[] }) {
  const [runIdx, setRunIdx] = useState(0);
  const run = runs[runIdx];
  const start = Math.max(0, (run?.frames[0]?.t ?? 0) - LEAD_IN);
  const [T, setT] = useState(start);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(1);
  const [cycle, setCycle] = useState(0);

  // Deep links for screenshots: ?run=replay&t=5200&speed=0.5&paused=1
  useEffect(() => {
    const q = readParams();
    const r = runs.findIndex((x) => x.file === q.get("run"));
    if (r >= 0) setRunIdx(r);
    const t = Number(q.get("t"));
    if (q.has("t") && Number.isFinite(t)) setT(t);
    const s = Number(q.get("speed"));
    if (SPEEDS.includes(s as (typeof SPEEDS)[number])) setSpeed(s);
    if (q.get("paused") === "1") setPlaying(false);
  }, [runs]);

  const host = useRef<HTMLDivElement>(null);
  const snaps = run?.frames ?? [];
  const p = useMemo(() => present(snaps, T), [snaps, T]);
  const endAt = p.endAt;

  // The motion CSS the runtime types out beside the surface: the real recipes this run's parts play.
  const code = useMemo(() => {
    const final = present(snaps, Infinity).parts;
    const keys = new Set(["skeleton reveal", ...final.filter((x) => x.leaf || x.type === "Card" || x.type === "Section").map((x) => fillRecipe(x.type))]);
    const lines = recipes.filter((r) => keys.has(r.key)).flatMap((r) => [...r.text.split("\n"), ""]);
    return lines.slice(0, 60);
  }, [snaps, recipes]);
  const finalCount = useMemo(() => present(snaps, Infinity).parts.length, [snaps]);
  const finalOps = useMemo(() => present(snaps, Infinity).ops, [snaps]);

  // transitions.dev UI generation (skeleton-texts), played per replay when the clock reaches the first frame.
  // The runtime has no progress control, so pause and step cancel it and show the surface as recorded;
  // it plays again on the next replay (loop, run pick or restart), not on resume mid-run.
  const replayKey = `${run?.file}-${cycle}`;
  const [genKey, setGenKey] = useState<string | null>(null);
  const nearFirst = p.firstAt != null && T >= p.firstAt && T - p.firstAt < 600;
  useEffect(() => {
    if (playing && nearFirst) setGenKey(replayKey);
  }, [playing, nearFirst, replayKey]);
  useEffect(() => {
    if (!playing) setGenKey(null);
  }, [playing]);
  const generating = useUIGeneration(host, {
    runKey: playing && p.ops && genKey === replayKey ? genKey : null,
    mode: "skeleton-texts",
    duration: Math.min(3600, Math.max(1600, 2400 / speed)),
    steps: ["Reading the prompt", "Picking components", "Streaming A2UI", "Adding motion"],
    done: `${finalCount} components ready`,
    title: run?.prompt,
    code,
    maxParts: 40,
  });

  // The runtime only draws its side panels (the parts log and the motion CSS) when the space beside the surface is on
  // screen, so while a build plays the surface is capped to the visible canvas; the rest shows once the build is done.
  const [builtKey, setBuiltKey] = useState<string | null>(null);
  const wasGenerating = useRef(false);
  useEffect(() => {
    if (generating) wasGenerating.current = true;
    else if (wasGenerating.current) {
      wasGenerating.current = false;
      setBuiltKey(replayKey);
    }
  }, [generating, replayKey]);
  const capped = playing && genKey === replayKey && builtKey !== replayKey;

  // Replay clock.
  const tRef = useRef(T);
  tRef.current = T;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = tRef.current + (now - last) * speed;
      last = now;
      if (endAt && next > endAt + HOLD) {
        setT(start);
        setCycle((c) => c + 1);
      } else setT(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, endAt, start]);

  const pickRun = (i: number) => {
    setRunIdx(i);
    setT(Math.max(0, (runs[i]?.frames[0]?.t ?? 0) - LEAD_IN));
    setCycle((c) => c + 1);
    setPlaying(true);
  };

  const step = useCallback(
    (dir: 1 | -1) => {
      setPlaying(false);
      const ts = Array.from(new Set(p.events.map((e) => Math.round(e.t)))).sort((a, b) => a - b);
      const now = tRef.current;
      if (dir === 1) {
        const n = ts.find((t) => t > now + 0.5);
        setT(n ?? Math.max(now, endAt));
      } else {
        const prev = ts.filter((t) => t < now - 0.5).pop();
        if (prev == null || prev < start) return setT(start);
        if (prev < now - 0.5 && now > endAt) return setT(prev);
        setT(prev);
      }
    },
    [p.events, endAt, start],
  );

  // Keyboard: space play/pause, arrows step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((v) => !v);
      } else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  // Measured rects of every component, relative to the stage.
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const shownOps = playing && genKey === replayKey && finalOps ? finalOps : p.ops;
  const shownRef = useRef(shownOps);
  shownRef.current = shownOps;
  const measure = useCallback(() => {
    const el = host.current;
    if (!el || !shownRef.current) return;
    const root = el.getBoundingClientRect();
    const next: Record<string, Rect> = {};
    for (const [id, n] of nodeElements(el, shownRef.current)) {
      const b = (n.firstElementChild as HTMLElement | null)?.getBoundingClientRect();
      if (b) next[id] = { x: b.left - root.left, y: b.top - root.top, w: b.width, h: b.height };
    }
    const sig = JSON.stringify(next);
    setRects((prev) => (JSON.stringify(prev) === sig ? prev : next));
  }, []);
  useLayoutEffect(measure);
  // The renderer mounts asynchronously: re-measure on any DOM or size change inside the stage.
  const hasOps = !!p.ops;
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let raf = 0;
    const later = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    const mo = new MutationObserver(later);
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state", "style"] });
    const ro = new ResizeObserver(later);
    ro.observe(el);
    return () => {
      mo.disconnect();
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [hasOps, measure, cycle, runIdx]);

  // The canvas follows the latest fill once the generation is over (the runtime needs the surface still).
  const canvas = useRef<HTMLDivElement>(null);
  const focusY = useMemo(() => {
    const last = p.events.filter((e) => e.t <= T && e.kind === "fill").pop();
    return last ? rects[last.id]?.y ?? null : null;
  }, [p.events, T, rects]);
  useEffect(() => {
    const el = canvas.current;
    if (!el || focusY == null || generating) return;
    const target = Math.max(0, focusY - el.clientHeight * 0.35);
    if (Math.abs(el.scrollTop - target) > 48) el.scrollTo({ top: target, behavior: "smooth" });
  }, [focusY, generating]);
  useEffect(() => {
    canvas.current?.scrollTo({ top: 0 });
  }, [cycle]);

  if (!run) return <div className="grid flex-1 place-items-center font-mono text-[13px] text-muted-foreground">No recorded runs in src/data.</div>;

  const preEvent = run.events.filter((e) => e.t <= T && !["frame", "op", "ops", "paint"].includes(e.kind)).pop();
  const done = p.done && T >= endAt;
  const status = !p.ops ? "Waiting for the model" : generating ? "Drawing the layout" : done ? "Done" : "Streaming";

  return (
    <div className="bs-root flex min-h-0 flex-1 flex-col">

      <section className="relative flex min-h-0 flex-1 flex-col">
        <div ref={canvas} className="bs-canvas relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {/* 544px wide: the runtime's parts log and motion CSS panels need 150px+ of empty canvas on each side. */}
          <div className="relative mx-auto w-full max-w-[592px] px-6 pb-40 pt-16">
            <div className="relative">
              {p.ops ? (
                <div
                  ref={host}
                  key={`${run.file}-${cycle}`}
                  className="relative"
                  style={capped ? { maxHeight: "calc(100dvh - 376px)", overflow: "hidden" } : undefined}
                  // A recording, not a form: its table headers and inputs stay out of the tab order.
                  inert
                >
                  {/* While the build plays, the whole recorded surface is in place so the runtime draws every part; paused or stepping shows exactly what had arrived. */}
                  <StaticSurface ops={shownOps!} />
                </div>
              ) : (
                <div className="grid h-[420px] place-items-center">
                  <div className="flex flex-col items-center gap-4 font-mono text-[13px] text-muted-foreground">
                    <Matrix />
                    <span>{preEvent?.label ?? "Prompt sent"}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <Controls
          runs={runs}
          runIdx={runIdx}
          onRun={pickRun}
          playing={playing}
          onToggle={() => {
            if (!playing && T >= endAt + HOLD - 50) {
              setT(start);
              setCycle((c) => c + 1);
            }
            setPlaying((v) => !v);
          }}
          onStep={step}
          speed={speed}
          onSpeed={setSpeed}
          progress={endAt > start ? (T - start) / (endAt - start) : 0}
          parts={`${p.parts.filter((x) => x.state === "filled").length} of ${finalCount} components`}
          status={status}
        />
      </section>

    </div>
  );
}

function Matrix() {
  return (
    <div className="t-matrix" aria-hidden>
      {Array.from({ length: 16 }, (_, i) => (
        <i key={i} style={{ "--d": ((i % 4) + Math.floor(i / 4)) * 90 } as React.CSSProperties} />
      ))}
    </div>
  );
}

function Controls({
  runs,
  runIdx,
  onRun,
  playing,
  onToggle,
  onStep,
  speed,
  onSpeed,
  progress,
  parts,
  status,
}: {
  runs: RecordedRun[];
  runIdx: number;
  onRun: (i: number) => void;
  playing: boolean;
  onToggle: () => void;
  onStep: (d: 1 | -1) => void;
  speed: number;
  onSpeed: (s: number) => void;
  progress: number;
  parts: string;
  status: string;
}) {
  return (
    <div className="bs-controls relative flex h-12 flex-none items-center gap-3 border-t border-border px-4 font-mono text-[12.5px]">
      <span className="bs-progress" style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress))})` }} aria-hidden />
      <select aria-label="Recorded run" value={runIdx} onChange={(e) => onRun(Number(e.target.value))} className="bs-select min-w-0 max-w-[260px] truncate">
        {runs.map((r, i) => (
          <option key={r.file} value={i}>
            {r.prompt}
          </option>
        ))}
      </select>
      <span className="hidden tabular-nums text-muted-foreground md:inline">
        {parts} <span className="bs-faint">·</span> {status}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <button className="bs-btn" aria-label="Step back one event" onClick={() => onStep(-1)}>
          <SkipBack className="size-3.5" />
        </button>
        <button className="bs-btn" aria-label={playing ? "Pause" : "Play"} onClick={onToggle}>
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </button>
        <button className="bs-btn" aria-label="Step forward one event" onClick={() => onStep(1)}>
          <SkipForward className="size-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-0.5" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button key={s} className="bs-speed" data-on={speed === s ? "true" : undefined} aria-pressed={speed === s} onClick={() => onSpeed(s)}>
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}

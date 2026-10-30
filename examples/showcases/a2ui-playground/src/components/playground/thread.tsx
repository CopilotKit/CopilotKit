"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { ActivityMessage } from "@ag-ui/client";
import { useAgent, useRenderActivityMessage } from "@copilotkit/react-core/v2";
import { GENERATIVE_UI_ACTIVITY_TYPE } from "@copilotkit/shared";
import { Code2, RotateCcw } from "lucide-react";
import { DotOutline } from "@/a2ui/catalog/renderers/blueprint";
import { ResizeBox } from "@/components/app/build-sequence";
import type { Mode } from "@/components/app/providers";
import { StaticSurface } from "@/components/app/static-surface";
import { useLandingReveal } from "@/components/app/use-landing-reveal";
import { useSend } from "@/components/app/use-send";
import { useUIGeneration } from "@/components/app/use-ui-generation";
import { modelLabel } from "@/lib/model-options";
import { nodeElements, nodeRect } from "@/lib/node-rects";
import { latestComponents, useRunStore, type A2UIOp, type RunRecord } from "@/lib/run-store";
import { cn } from "@/lib/utils";
import { focusRing } from "./composer";
import { activeId, runStatus, useLink, type LineFormat } from "./lines";
import type { Replay } from "./replay";
import { runOf, type Turn } from "./turns";

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The surface the writes pane shows, and what the thread needs to link its lines to its components. */
export type Selection = {
  /** `replay` for the recording, else the surface's activity message id. */
  key: string | null;
  count: number;
  format: LineFormat;
  lineOf: Map<string, number>;
  ops: A2UIOp[] | null;
};

/** `turnId` null: the recording. `open`: on a phone, open the Express view too. */
export type OnSelect = (turnId: string | null, open: boolean) => void;

/**
 * The conversation: a compact intro, then each prompt with the UI it asked for, inline, painting as the
 * model writes it. Surfaces render through the provider's Gen UI 2.0 activity renderer
 * (src/components/app/surface-renderer.tsx), so their buttons and inputs still reach the agent.
 * The first visit plays a recorded run into the thread.
 */
export function Thread({ turns, replay, selection, onSelect }: { turns: Turn[]; replay: Replay; selection: Selection; onSelect: OnSelect }) {
  const scroller = useRef<HTMLDivElement>(null);
  useAgentPulse();
  const showReplay = (replay.status === "playing" || replay.status === "ended") && replay.sent;
  const lastId = turns[turns.length - 1]?.id ?? null;

  // The last turn is at least as tall as the view, so a new prompt can scroll to the top and its UI paints below it, in view.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => el.style.setProperty("--thread-h", `${el.clientHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A click or key press inside a surface can start a turn of its own (Gen UI 2.0 forwards the action
  // to the agent). That turn does not take the view: the surface the visitor is using stays in sight.
  const actedAt = useRef(0);
  const quiet = useRef(new Set<string>()).current;
  const seen = useRef<string | null>(null);
  if (lastId && seen.current !== null && lastId !== seen.current && performance.now() - actedAt.current < 4000) quiet.add(lastId);

  // A new prompt brings its turn to the top. A chat restored from earlier opens on its last turn.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !lastId || lastId === seen.current) return;
    const restored = seen.current === null;
    seen.current = lastId;
    const turn = el.querySelector<HTMLElement>(`[data-turn="${CSS.escape(lastId)}"]`);
    if (!turn) return;
    // A turn from a surface action: kept in view as its answer grows, until the visitor scrolls.
    if (quiet.has(lastId)) {
      let moved = false;
      const stop = () => {
        moved = true;
      };
      const ro = new ResizeObserver(() => {
        if (!moved) turn.scrollIntoView({ block: "nearest" });
      });
      ro.observe(turn);
      el.addEventListener("wheel", stop, { passive: true });
      el.addEventListener("touchmove", stop, { passive: true });
      return () => {
        ro.disconnect();
        el.removeEventListener("wheel", stop);
        el.removeEventListener("touchmove", stop);
      };
    }
    const toTurn = (smooth: boolean) => {
      const top = turn.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 16;
      el.scrollTo({ top, behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
    };
    toTurn(!restored);
    // Restored surfaces settle their height a moment after they mount.
    if (restored) {
      const t = setTimeout(() => toTurn(false), 400);
      return () => clearTimeout(t);
    }
  }, [lastId]);

  // Where each surface shows. An update changes an earlier surface in place, and a typed follow-up brings
  // that surface down under itself, so the answer sits under its question. A click inside a surface (a
  // quiet turn) changes it where the visitor is looking.
  const runs = useRunStore((s) => s.runs);
  const updatedKeyOf = new Map<string, string>();
  const shownAt = new Map<string, string>();
  let prevKey: string | null = null;
  for (const t of turns) {
    if (t.surfaceKey) {
      shownAt.set(t.surfaceKey, t.id);
      prevKey = t.surfaceKey;
      continue;
    }
    const run = runOf(t, runs);
    // The update may reach the surface without touching its activity message, so a finished turn that called a tool and drew nothing of its own counts as one.
    const key = run?.surfaceKey ?? (t.acted && !t.text && (!run || run.status === "done") ? prevKey : null);
    if (!key) continue;
    updatedKeyOf.set(t.id, key);
    if (!quiet.has(t.id)) shownAt.set(key, t.id);
  }

  return (
    <div
      ref={scroller}
      className="wb-scroll relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
      data-thread
      onPointerDownCapture={(e) => {
        if ((e.target as Element).closest?.(".wb-floor")) actedAt.current = performance.now();
      }}
      onKeyDownCapture={(e) => {
        if ((e.key === "Enter" || e.key === " ") && (e.target as Element).closest?.(".wb-floor")) actedAt.current = performance.now();
      }}
    >
      <div className="mx-auto w-full max-w-[844px] px-8 max-[1279px]:px-6 max-[899px]:px-4">
        <header className="pb-8 pt-8 max-[1279px]:pt-7 max-[899px]:pb-6 max-[899px]:pt-5">
          <h1 className="text-balance text-[32px] font-semibold leading-[1.08] tracking-[-0.025em] max-[1279px]:text-[28px] max-[899px]:text-[25px]">Watch an&nbsp;agent write&nbsp;UI.</h1>
          <p className="mt-2.5 max-w-[62ch] text-[14px] leading-[1.55] text-[var(--pg-dim)] max-[899px]:mt-2">
            A2UI 1.0 is Google&apos;s open protocol for agents that answer with UI: the model writes one line per component, and your components draw it.
          </p>
        </header>

        <HoverArea selection={selection}>
          <ol aria-label="Conversation" className="flex flex-col gap-10 pb-6 max-[899px]:gap-8">
            {showReplay ? <ReplayTurn replay={replay} sel={selection.key === "replay" ? selection : null} onSelect={onSelect} scroller={scroller} last={!turns.length} /> : null}
            {turns.map((t, i) => {
              const updatedKey = updatedKeyOf.get(t.id) ?? null;
              const mine = t.surfaceKey ?? updatedKey;
              const showKey = mine && shownAt.get(mine) === t.id ? mine : null;
              return (
                <TurnView
                  key={t.id}
                  turn={t}
                  showKey={showKey}
                  updatedKey={updatedKey}
                  last={i === turns.length - 1}
                  fill={i === turns.length - 1 && !quiet.has(t.id)}
                  sel={showKey && showKey === selection.key ? selection : null}
                  onSelect={onSelect}
                  scroller={scroller}
                />
              );
            })}
          </ol>
        </HoverArea>

        {!turns.length && !showReplay && replay.status === "off" ? (
          <div className="rounded-[14px] border border-dashed border-[var(--pg-line-strong)] px-6 py-10 text-center">
            <p className="text-[15px] font-medium text-foreground/90">Your UI draws here, in the conversation.</p>
            <p className="mt-1.5 text-[13.5px] text-[var(--pg-dim)]">Ask for something, or pick one of the prompts below.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ───────────────────────── component -> line ───────────────────────── */

/**
 * Hovering a component of the selected surface lights its line. One listener for the whole thread; its
 * children are passed in, so a hover re-renders this wrapper and not the conversation.
 */
function HoverArea({ selection, children }: { selection: Selection; children: React.ReactNode }) {
  const { setHover } = useLink();
  return (
    <div
      onPointerOver={(e) => {
        const target = e.target as Element;
        const floor = target.closest?.("[data-link-floor]");
        setHover(floor ? surfaceHover(target, floor, selection.ops, selection.lineOf) : null);
      }}
      onPointerLeave={() => setHover(null)}
    >
      {children}
    </div>
  );
}

/** The innermost component under the pointer that has a line of its own. */
function surfaceHover(target: Element, host: Element, ops: A2UIOp[] | null, lineOf: Map<string, number>) {
  if (!ops) return null;
  const idOf = new Map<Element, string>();
  for (const [id, el] of nodeElements(host, ops)) idOf.set(el, id);
  for (let el: Element | null = target; el && el !== host; el = el.parentElement) {
    const id = idOf.get(el);
    if (id && lineOf.has(id)) return { id, from: "surface" as const };
  }
  return null;
}

/* ───────────────────────── one turn ───────────────────────── */

const TurnView = memo(function TurnView({
  turn,
  showKey,
  updatedKey,
  last,
  fill,
  sel,
  onSelect,
  scroller,
}: {
  turn: Turn;
  /** The surface drawn under this turn: its own, or the one it updated, when no later turn took it down. */
  showKey: string | null;
  /** The earlier surface this turn changed, if any. */
  updatedKey: string | null;
  last: boolean;
  /** At least as tall as the view, so the turn can scroll to the top with room for its UI below. */
  fill: boolean;
  sel: Selection | null;
  onSelect: OnSelect;
  scroller: RefObject<HTMLDivElement | null>;
}) {
  const run = useRunStore((s) => runOf(turn, s.runs));
  const running = run?.status === "running";
  // This turn's surface was taken further down by a later follow-up; or this turn changed one that stays above.
  const movedDown = !!turn.surfaceKey && !showKey;
  const updated = !showKey && !turn.surfaceKey ? updatedKey : null;

  return (
    <li data-turn={turn.id} className={cn("flex flex-col gap-3", fill && "min-h-[calc(var(--thread-h,0px)-40px)]")}>
      <Bubble text={turn.prompt} />
      {showKey ? (
        <SurfaceBlock surfaceKey={showKey} turnId={turn.id} run={run} sel={sel} onSelect={onSelect} scroller={scroller} />
      ) : movedDown ? (
        <p className="text-[13.5px] text-[var(--pg-dim)]" data-moved>
          Updated below.
        </p>
      ) : updated ? (
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13.5px] text-[var(--pg-dim)]" data-updated={updated}>
          {running ? <span aria-hidden className="wb-pulse size-1.5 flex-none rounded-full bg-[var(--wb-violet)]" /> : null}
          {running ? "Changing the UI above." : "Changed the UI above."}
          <button
            type="button"
            onClick={() => {
              onSelect(turn.id, false);
              scroller.current?.querySelector(`[data-surface-block="${CSS.escape(updated)}"]`)?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
            }}
            className={cn("rounded-sm font-medium text-foreground underline decoration-[var(--pg-line-strong)] underline-offset-4 hover:decoration-foreground", focusRing)}
          >
            Show it
          </button>
        </p>
      ) : running ? (
        // Before the run has a surface: the same block, so its frame stays put when the surface arrives.
        <SurfaceBlock surfaceKey={null} turnId={turn.id} run={run} sel={null} onSelect={onSelect} scroller={scroller} />
      ) : null}
      {turn.text ? <p className="max-w-[62ch] whitespace-pre-wrap text-[14.5px] leading-relaxed text-foreground/90">{turn.text}</p> : null}
      {run ? <RunNotice run={run} latest={last} /> : null}
    </li>
  );
});

function Bubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[min(80%,560px)] whitespace-pre-wrap break-words rounded-[14px] border border-[var(--pg-line)] bg-[var(--pg-panel)] px-4 py-2.5 text-[14.5px] leading-[1.5] text-foreground max-[899px]:max-w-[88%]">{text}</p>
    </div>
  );
}

/**
 * A surface of the conversation, on its dot-grid floor, with the chip that shows its lines. With no
 * `surfaceKey` (a run that has not drawn yet) it is the floor with one generation frame and the run's status.
 */
function SurfaceBlock({
  surfaceKey,
  turnId,
  run,
  sel,
  onSelect,
  scroller,
}: {
  surfaceKey: string | null;
  turnId: string;
  run: RunRecord | undefined;
  sel: Selection | null;
  onSelect: OnSelect;
  scroller: RefObject<HTMLDivElement | null>;
}) {
  const message = useSurfaceMessage(surfaceKey);
  const floor = useRef<HTMLDivElement>(null);
  const written = run?.lines.filter((l) => l.kind === "line") ?? [];
  const format: LineFormat = sel ? sel.format : (written[written.length - 1]?.format ?? (run?.format === "json" ? "json" : "express"));
  const count = sel ? sel.count : written.length;
  const running = run?.status === "running";
  // Nothing to show yet: no surface, or a composed one, which exists from the moment the model starts and is
  // empty until its first statement compiles.
  const waiting = !message || (running && !latestComponents(((message.message.content as { operations?: A2UIOp[] }).operations ?? []) as A2UIOp[]).length);
  return (
    <div data-surface-block={surfaceKey ?? undefined} className="scroll-mt-4">
      <SurfaceMeta
        chip={!!surfaceKey}
        selected={!!sel}
        label={`${format === "json" ? "JSON" : "Express"}${count ? ` · ${count} ${count === 1 ? "line" : "lines"}` : ""}`}
        onOpen={() => onSelect(turnId, true)}
        status={run?.status}
        meta={run ? [run.model ? modelLabel(run.model) : null, run.path === "fixed" ? "template" : null, running ? runStatus(run) : STATUS[run.status]].filter(Boolean).join(" · ") : null}
      />
      <div
        ref={floor}
        className={cn("wb-floor relative rounded-[14px] border p-5 transition-colors max-[899px]:p-3.5", sel ? "border-[var(--pg-line-strong)]" : "border-[var(--pg-line)]")}
        data-link-floor={sel ? "" : undefined}
        // Any click on a surface selects it (a button inside it still does its own thing).
        onPointerDownCapture={() => {
          if (!sel) onSelect(turnId, false);
        }}
      >
        {message ? <LiveSurface message={message.message} version={message.version} /> : null}
        {waiting ? <Waiting /> : null}
        {sel ? <LinkOverlay content={floor} scroller={scroller} ops={sel.ops} lineOf={sel.lineOf} /> : null}
      </div>
    </div>
  );
}

/** A finished run's word for the meta line; a running one shows its latest step instead (`runStatus`). */
const STATUS: Record<RunRecord["status"], string | null> = { running: null, done: null, error: "failed", stopped: "stopped" };

function SurfaceMeta({
  chip = true,
  selected,
  label,
  onOpen,
  status,
  meta,
  children,
}: {
  /** false: no surface yet, so no lines to show; the row keeps its height for the chip that comes. */
  chip?: boolean;
  selected: boolean;
  label: string;
  onOpen: () => void;
  status?: RunRecord["status"];
  meta: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex min-h-7 min-w-0 items-center gap-3">
      {chip ? (
        <button
          type="button"
          data-code-chip
          aria-pressed={selected}
          title={selected ? "These lines show beside the conversation" : "Show the lines that made this UI"}
          onClick={onOpen}
          className={cn(
            "inline-flex h-7 flex-none items-center gap-1.5 rounded-full border px-2.5 font-mono text-[12px] transition-colors",
            selected ? "border-[var(--pg-line-strong)] bg-[var(--pg-raised)] text-foreground" : "border-[var(--pg-line)] text-[var(--pg-dim)] hover:border-[var(--pg-line-strong)] hover:text-foreground",
            focusRing,
          )}
        >
          <Code2 className="size-3.5" aria-hidden />
          {label}
        </button>
      ) : null}
      {meta ? (
        <span className={cn("flex min-w-0 items-center gap-2 font-mono text-[12px]", status === "error" ? "text-[var(--wb-red)]" : "text-[var(--pg-dim)]")}>
          {status === "running" ? <span aria-hidden className="wb-pulse size-1.5 flex-none rounded-full bg-[var(--wb-violet)]" /> : null}
          {/* The run's latest step while it runs ("Writing A2UI Express"), said quietly, also to a screen reader. */}
          <span className="truncate" aria-live="polite">
            {meta}
          </span>
        </span>
      ) : null}
      {children}
    </div>
  );
}

/** The recording, played into the thread: its prompt, then its UI at the recorded times. */
function ReplayTurn({ replay, sel, onSelect, scroller, last }: { replay: Replay; sel: Selection | null; onSelect: OnSelect; scroller: RefObject<HTMLDivElement | null>; last: boolean }) {
  const floor = useRef<HTMLDivElement>(null);
  return (
    <li data-turn="replay" className={cn("flex flex-col gap-3", last && "min-h-[calc(var(--thread-h,0px)-40px)]")}>
      <Bubble text={replay.prompt} />
      <div data-surface-block="replay">
        <SurfaceMeta
          selected={!!sel}
          label={`Express${sel?.count ? ` · ${sel.count} ${sel.count === 1 ? "line" : "lines"}` : ""}`}
          onOpen={() => onSelect(null, true)}
          status={replay.status === "playing" ? "running" : "done"}
          meta={
            <>
              Recorded run<span className="max-[479px]:hidden"> · {replay.model}</span>
              {replay.status === "playing" ? " · Writing A2UI Express" : null}
            </>
          }
        >
          {replay.status === "ended" ? (
            <button
              type="button"
              onClick={replay.restart}
              className={cn("ml-auto inline-flex h-7 flex-none items-center gap-1.5 rounded-md px-2 text-[12.5px] text-[var(--pg-dim)] transition-colors hover:text-foreground", focusRing)}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Play again
            </button>
          ) : null}
        </SurfaceMeta>
        <div ref={floor} className={cn("wb-floor relative rounded-[14px] border p-5 max-[899px]:p-3.5", sel ? "border-[var(--pg-line-strong)]" : "border-[var(--pg-line)]")} data-link-floor={sel ? "" : undefined}>
          {replay.ops ? <ReplaySurface ops={replay.ops} runKey={replay.runKey} live={replay.status === "playing"} /> : <Waiting />}
          {sel ? <LinkOverlay content={floor} scroller={scroller} ops={sel.ops} lineOf={sel.lineOf} /> : null}
        </div>
      </div>
    </li>
  );
}

/* ───────────────────────── line -> component ───────────────────────── */

type Box = { x: number; y: number; w: number; h: number };

/**
 * The blue outline around the component of the line under the pointer or focus (or pinned), tagged with
 * its line number. Measured every frame while it shows: the surface keeps moving as it paints. A line
 * hovered in the writes pane scrolls the conversation to its component.
 */
function LinkOverlay({ content, scroller, ops, lineOf }: { content: RefObject<HTMLDivElement | null>; scroller: RefObject<HTMLDivElement | null>; ops: A2UIOp[] | null; lineOf: Map<string, number> }) {
  const link = useLink();
  const id = activeId(link);
  const fromLine = link.hover ? link.hover.from === "line" : !!link.pinned;
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    if (!id || !ops) {
      setBox(null);
      return;
    }
    let raf = 0;
    let el: HTMLElement | undefined;
    let last = "";
    let scrolled = !fromLine;
    const tick = () => {
      const host = content.current;
      if (host && (!el || !el.isConnected)) el = nodeElements(host, ops).get(id);
      const r = el ? nodeRect(el) : null;
      if (host && r) {
        const c = host.getBoundingClientRect();
        const next = { x: Math.round(r.left - c.left), y: Math.round(r.top - c.top), w: Math.round(r.width), h: Math.round(r.height) };
        const sig = `${next.x},${next.y},${next.w},${next.h}`;
        if (sig !== last) {
          last = sig;
          setBox(next);
        }
        const sc = scroller.current;
        if (!scrolled && sc) {
          scrolled = true;
          const s = sc.getBoundingClientRect();
          const above = r.top < s.top + 24;
          const below = r.bottom > s.bottom - 24;
          if (above || below) {
            const delta = above || r.height > s.height - 64 ? r.top - s.top - 40 : r.bottom - s.bottom + 40;
            sc.scrollBy({ top: delta, behavior: reducedMotion() ? "auto" : "smooth" });
          }
        }
      } else if (last !== "none") {
        last = "none";
        setBox(null);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [id, ops, fromLine, content, scroller]);
  if (!box || !id) return null;
  const n = lineOf.get(id);
  return (
    <div aria-hidden className="wb-link-box" style={{ left: box.x - 4, top: box.y - 4, width: box.w + 8, height: box.h + 8 }} data-link-box={id}>
      {n ? <span className="wb-link-tag">line {n}</span> : null}
    </div>
  );
}

/* ───────────────────────── surfaces ───────────────────────── */

/** What changes a surface's activity message: more operations, or its status. */
function surfaceVersion(message: ActivityMessage) {
  const c = message.content as { operations?: unknown[]; status?: string; rejected?: unknown[] };
  return `${c.operations?.length ?? 0}|${c.status}|${c.rejected?.length ?? 0}`;
}

/**
 * Agent events, once a frame. The thread subscribes when it mounts: a subscriber added during a run
 * hears nothing of that run, and a surface block mounts mid-run. Activity deltas do not report a
 * messages change, so blocks re-read their surface after any event and when a run ends.
 */
const pulse = new Set<() => void>();

function useAgentPulse() {
  const { agent } = useAgent({ agentId: "default", updates: [] });
  useEffect(() => {
    if (!agent) return;
    let raf = 0;
    const later = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          pulse.forEach((fn) => fn());
        });
    };
    const sub = agent.subscribe({ onMessagesChanged: later, onEvent: later, onRunFinalized: later });
    return () => {
      cancelAnimationFrame(raf);
      sub.unsubscribe();
    };
  }, [agent]);
}

/** The activity message of a surface, re-rendered only when the surface changed. */
function useSurfaceMessage(key: string | null): { message: ActivityMessage; version: string } | null {
  const { agent } = useAgent({ agentId: "default", updates: [] });
  const [state, setState] = useState<{ message: ActivityMessage; version: string } | null>(null);
  useEffect(() => {
    if (!agent) return;
    let last = "";
    const read = () => {
      const m = key ? (agent.messages.find((x) => x.id === key && x.role === "activity" && x.activityType === GENERATIVE_UI_ACTIVITY_TYPE) as ActivityMessage | undefined) : undefined;
      const version = m ? surfaceVersion(m) : "";
      if (version === last) return;
      last = version;
      setState(m ? { message: m, version } : null);
    };
    read();
    pulse.add(read);
    return () => {
      pulse.delete(read);
    };
  }, [agent, key]);
  return state;
}

/**
 * The surface of an activity message, through the provider's activity renderers (the playground's mirror,
 * then Gen UI 2.0's own). Re-rendered only when the surface changed, not when a hover lights a line.
 */
const LiveSurface = memo(
  function LiveSurface({ message }: { message: ActivityMessage; version: string }) {
    const { renderActivityMessage } = useRenderActivityMessage();
    return <div className="wb-surface">{renderActivityMessage(message)}</div>;
  },
  (a, b) => a.message.id === b.message.id && a.version === b.version,
);

/**
 * A recorded snapshot. Its first frame plays the whole transitions.dev drawing (the recording opens on the
 * finished first screen of a run); what lands after it reveals component by component, as a live run does.
 */
const ReplaySurface = memo(function ReplaySurface({ ops, runKey, live }: { ops: A2UIOp[]; runKey: string; live: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const generating = useUIGeneration(host, { runKey, mode: "skeleton", maxParts: 40 });
  useLandingReveal(host, live && !generating);
  return (
    <div className="wb-surface">
      <ResizeBox>
        <div ref={host} key={runKey} className="a2-surface-host relative" data-replay>
          <StaticSurface ops={ops} />
        </div>
      </ResizeBox>
    </div>
  );
});

/** Nothing has drawn yet: one transitions.dev generation frame, the shape of a pending component's (Blueprint). */
function Waiting() {
  return (
    <div aria-hidden className="wb-wait gen-field min-h-[132px] rounded-[12px]" data-waiting>
      <DotOutline r={11} />
    </div>
  );
}

/** A failed or stopped run, in plain words. The latest one can be asked again (same prompt and mode, the model picked now). */
function RunNotice({ run, latest }: { run: RunRecord; latest: boolean }) {
  const { send, running } = useSend();
  if (run.status !== "error" && run.status !== "stopped") return null;
  const stopped = run.status === "stopped";
  return (
    <div
      role={stopped ? "status" : "alert"}
      data-run-notice={run.status}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] px-4 py-3 text-[14px]",
        stopped ? "border border-[var(--pg-line)] bg-[var(--pg-panel)] text-[var(--pg-dim)]" : "border border-[var(--wb-red-line)] bg-[var(--wb-red-wash)] text-foreground",
      )}
    >
      <span className="min-w-0 flex-1">{stopped ? "Stopped." : run.error}</span>
      {latest && !running ? (
        <button
          type="button"
          onClick={() => void send(run.prompt, { mode: run.mode as Mode })}
          className={cn("flex-none rounded-md border border-[var(--pg-line-strong)] bg-[var(--pg-panel)] px-2.5 py-1 text-[13px] font-medium text-foreground transition-colors hover:bg-[var(--pg-raised)]", focusRing)}
        >
          {stopped ? "Ask again" : "Retry"}
        </button>
      ) : null}
    </div>
  );
}

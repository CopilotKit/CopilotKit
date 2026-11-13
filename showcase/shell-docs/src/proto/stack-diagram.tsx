"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { frontendHref } from "@/lib/live-scope";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { FrontendLogo } from "@/components/icons/frontend-logo";
import { FRAMEWORKS, FRONTENDS, frameworkById, frontendById } from "./data";
import type { FrontendId } from "./data";
import { useFrontend } from "./frontend";
import { useLastFramework } from "./last-framework";
import { frameworkHref } from "./routes";

/*
 * The product in one picture, the way copilotkit.ai draws its protocol map:
 * frontends on the left, CopilotKit's ink tile in the middle, agent
 * frameworks on the right, as tiles with rims on the website's stage. Each
 * side is a vertical carousel with arrows above and below it; the frontends
 * drift up and the frameworks down, in turn. One request at a time makes the
 * trip: a single dot runs from a frontend into CopilotKit and out to an
 * agent, then the reply comes back, lighting the wire it's on, and
 * CopilotKit pulses softly as each passes through. Each column is a fisheye,
 * largest level with CopilotKit, and each mark opens its docs. The reader's
 * own stack is a solid white tile on a solid wire, and every other trip
 * takes its wires. All of
 * it stops off screen and for reduced motion; the carousels also pause on
 * hover.
 */
const W = 440;
const H = 312;
const TILE = 48;
const MID = 156;
const LEFT_X = 40;
const RIGHT_X = 400;
/**
 * Each column is a fisheye of five rows: the middle row, level with
 * CopilotKit, is enlarged, and the rows shrink and fade toward the top and
 * bottom.
 * Indexed by row from the one waiting above (-1) to the one waiting below
 * (5); rows 0 to 4 are in view.
 */
const ROW_Y = [32, 60, 99, MID, 213, 252, 280];
const ROW_SCALE = [0.3, 0.5, 0.8, 1.25, 0.8, 0.5, 0.3];
/** The outer rows also fade back a little, so the middle row leads. */
const ROW_OPACITY = [0, 0.7, 0.9, 1, 0.9, 0.7, 0];
const VISIBLE = 5;
const rowY = (k: number) => ROW_Y[k + 1];
const rowScale = (k: number) => ROW_SCALE[k + 1];
const rowOpacity = (k: number) => ROW_OPACITY[k + 1];
/** The rows in view, top to bottom. */
const ROWS = ROW_Y.slice(1, 1 + VISIBLE);
/** The columns scroll in turn, one row every TURN. */
const TURN = 2100;
/** Where the arrows sit, above and below the columns. */
const ARROW_TOP = 16;
const ARROW_BOTTOM = H - 16;

const pct = (v: number, of: number) => `${(v / of) * 100}%`;
const mod = (n: number, m: number) => ((n % m) + m) % m;

/**
 * Variants that share a logo (LangGraph Python and TypeScript, React and
 * React Native, ...) count as one, so a column never shows a mark twice.
 */
function family(id: string) {
  if (id === "react-native") return "react";
  return /^(langgraph|crewai|strands|ms|claude)-/.test(id)
    ? id.split("-")[0]
    : id;
}

function distinct(ids: string[]) {
  return ids.filter(
    (id, i) => ids.findIndex((other) => family(other) === family(id)) === i,
  );
}

const FRONTEND_POOL = distinct(FRONTENDS.map((f) => f.id));
// CopilotKit's own agent is the middle tile, so it isn't in the right column.
const AGENT_POOL = distinct(
  FRAMEWORKS.map((f) => f.id).filter((id) => id !== "built-in-agent"),
);

/** The offset that shows `pick` in the middle row, so it leads the map at first. */
function startOffset(pool: string[], pick: string | undefined) {
  const at = pick ? pool.findIndex((id) => family(id) === family(pick)) : -1;
  return at < 0 ? 0 : at - 2;
}

/**
 * `live` while the map is on screen, the page is visible, and motion is
 * allowed; `running` while it's live and no one hovers it.
 */
function useRunning() {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState({ live: false, running: false });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    let hovered = false;
    const sync = () => {
      const live = visible && !document.hidden && !motion.matches;
      setState({ live, running: live && !hovered });
    };
    const observer = new IntersectionObserver((entries) => {
      visible = entries.at(-1)?.isIntersecting ?? false;
      sync();
    });
    const enter = () => {
      hovered = true;
      sync();
    };
    const leave = () => {
      hovered = false;
      sync();
    };
    observer.observe(el);
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    motion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointerleave", leave);
      motion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return [ref, state.live, state.running] as const;
}

type Side = 0 | 1;

/**
 * Both columns' scroll positions. The columns take turns: every TURN the
 * side whose turn it is moves one row (the frontends up, the frameworks
 * down) while `running`. Moving a column by hand (`nudge`) restarts the
 * clock and hands the next turn to the other column, so the one the reader
 * just moved holds still until the other has scrolled.
 */
function useTurns(
  pools: [string[], string[]],
  picks: [string | undefined, string | undefined],
  running: boolean,
) {
  const fresh = (side: Side) => startOffset(pools[side], picks[side]);
  const [state, setState] = useState(() => ({
    picks,
    offsets: [fresh(0), fresh(1)] as [number, number],
    turn: 0 as Side,
  }));
  // A new pick brings it back into view, in render so there's no stale frame.
  if (state.picks[0] !== picks[0] || state.picks[1] !== picks[1]) {
    setState((s) => ({
      ...s,
      picks,
      offsets: [
        s.picks[0] !== picks[0] ? fresh(0) : s.offsets[0],
        s.picks[1] !== picks[1] ? fresh(1) : s.offsets[1],
      ],
    }));
  }
  const [clock, setClock] = useState(0);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setState((s) => {
        const offsets = [...s.offsets] as [number, number];
        offsets[s.turn] += s.turn === 0 ? 1 : -1;
        return { ...s, offsets, turn: (1 - s.turn) as Side };
      });
    }, TURN);
    return () => window.clearInterval(id);
  }, [running, clock]);

  const nudge = (side: Side, by: 1 | -1) => {
    setState((s) => {
      const offsets = [...s.offsets] as [number, number];
      offsets[side] += by;
      return { ...s, offsets, turn: (1 - side) as Side };
    });
    setClock((c) => c + 1);
  };
  return [state.offsets, nudge] as const;
}

const ROW_EASE =
  "transition-[translate,scale,opacity] duration-[640ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none";

function Tile({
  x,
  y,
  size = TILE,
  label,
  selected = false,
  children,
  className = "",
  style,
  href,
  hidden = false,
}: {
  x: number;
  y: number;
  size?: number;
  label: string;
  selected?: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Makes the tile a link to that page. */
  href?: string;
  /** Out of view: not focusable or announced. */
  hidden?: boolean;
}) {
  const Root = href ? Link : "div";
  return (
    <Root
      href={href!}
      title={label}
      aria-label={href ? label : undefined}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      className={cn(
        "absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-[24%] border-2 shadow-[0_14px_26px_rgb(31_38_36/0.12)]",
        selected ? "border-white bg-white" : "border-stage-rim bg-stage-tile",
        className,
      )}
      style={{
        left: pct(x, W),
        top: pct(y, H),
        width: pct(size, W),
        height: pct(size, H),
        ...style,
      }}
    >
      {children}
    </Root>
  );
}

/**
 * A side of the map as a vertical carousel: the five rows in view, plus the
 * row above and below waiting out of sight, so a scroll slides the next mark
 * in from the edge instead of popping it into place. Each mark opens its
 * docs.
 */
function Column({
  x,
  pool,
  offset,
  isPick,
  label,
  logo,
  href,
}: {
  x: number;
  pool: string[];
  offset: number;
  isPick: (id: string) => boolean;
  label: (id: string) => string;
  logo: (id: string) => ReactNode;
  href: (id: string) => string;
}) {
  const rows = [-1, 0, 1, 2, 3, 4, 5];
  return rows.map((k) => {
    const at = offset + k;
    const id = pool[mod(at, pool.length)];
    const shown = k >= 0 && k < VISIBLE;
    return (
      <Tile
        key={at}
        x={x}
        y={MID}
        label={label(id)}
        href={href(id)}
        hidden={!shown}
        selected={isPick(id)}
        className={cn(
          ROW_EASE,
          "outline-none hover:border-white focus-visible:ring-2 focus-visible:ring-white",
          !shown && "pointer-events-none",
        )}
        style={{
          translate: `-50% calc(-50% + ${((rowY(k) - MID) * 100) / TILE}%)`,
          scale: String(rowScale(k)),
          opacity: rowOpacity(k),
        }}
      >
        {logo(id)}
      </Tile>
    );
  });
}

/** An arrow above or below a column, scrolling it by one. */
function Arrow({
  x,
  y,
  up,
  label,
  onClick,
}: {
  x: number;
  y: number;
  up: boolean;
  label: string;
  onClick: () => void;
}) {
  const Icon = up ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-stage-rim bg-stage-tile text-brand-plum shadow-[0_4px_10px_rgb(31_38_36/0.1)] transition-[background-color,scale] duration-150 hover:bg-white active:scale-90 focus-visible:outline-2 focus-visible:outline-white motion-reduce:transition-none dark:text-white dark:hover:bg-white/20 [&_svg]:size-4"
      style={{ left: pct(x, W), top: pct(y, H) }}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}

type Lit = { side: "left" | "right"; row: number } | null;

const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/**
 * One request at a time: a dot runs from a frontend's wire into CopilotKit
 * and out along an agent's, rests, then the reply runs back. The wire under
 * the dot is lit. Every other trip takes the reader's own wires when their
 * pick is in view. Drawn with requestAnimationFrame on the paths themselves,
 * and stopped (dot hidden) whenever the map isn't live.
 */
function useTraffic(
  live: boolean,
  picks: { left: number; right: number },
  onCore: () => void,
) {
  const left = useRef<(SVGPathElement | null)[]>([]);
  const right = useRef<(SVGPathElement | null)[]>([]);
  const dot = useRef<SVGGElement>(null);
  const [lit, setLit] = useState<Lit>(null);
  const picksRef = useRef(picks);
  const coreRef = useRef(onCore);
  useEffect(() => {
    picksRef.current = picks;
    coreRef.current = onCore;
  });

  useEffect(() => {
    const g = dot.current;
    if (!live || !g) return;
    let cancelled = false;
    let frame = 0;
    let timer = 0;
    const show = (on: boolean) => {
      g.style.opacity = on ? "1" : "0";
    };
    const wait = (ms: number) =>
      new Promise<void>((done) => {
        timer = window.setTimeout(done, ms);
      });
    const run = (path: SVGPathElement, back: boolean, ms: number) =>
      new Promise<void>((done) => {
        const length = path.getTotalLength();
        const start = performance.now();
        const step = (now: number) => {
          if (cancelled) return;
          const t = Math.min(1, (now - start) / ms);
          const e = easeInOut(t);
          const p = path.getPointAtLength((back ? 1 - e : e) * length);
          g.setAttribute("transform", `translate(${p.x} ${p.y})`);
          if (t < 1) frame = requestAnimationFrame(step);
          else done();
        };
        frame = requestAnimationFrame(step);
      });
    const choose = (picked: number, trip: number) =>
      picked >= 0 && trip % 2 === 0
        ? picked
        : Math.floor(Math.random() * ROWS.length);

    (async () => {
      await wait(800);
      for (let trip = 0; !cancelled; trip++) {
        const l = choose(picksRef.current.left, trip);
        const r = choose(picksRef.current.right, trip);
        const lp = left.current[l];
        const rp = right.current[r];
        if (!lp || !rp) {
          await wait(400);
          continue;
        }
        // The request: frontend, through CopilotKit, to the agent.
        show(true);
        setLit({ side: "left", row: l });
        await run(lp, false, 1100);
        if (cancelled) return;
        coreRef.current();
        setLit({ side: "right", row: r });
        await run(rp, false, 1100);
        if (cancelled) return;
        show(false);
        setLit(null);
        await wait(600);
        if (cancelled) return;
        // The reply, back the way it came.
        show(true);
        setLit({ side: "right", row: r });
        await run(rp, true, 1100);
        if (cancelled) return;
        coreRef.current();
        setLit({ side: "left", row: l });
        await run(lp, true, 1100);
        if (cancelled) return;
        show(false);
        setLit(null);
        await wait(1400);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      show(false);
    };
  }, [live]);

  return { left, right, dot, lit: live ? lit : null };
}

/** A wire: faint at rest, solid on the reader's stack, lit under the dot. */
function Wire({
  d,
  picked,
  lit,
  pathRef,
}: {
  d: string;
  picked: boolean;
  lit: boolean;
  pathRef: (el: SVGPathElement | null) => void;
}) {
  return (
    <path
      ref={pathRef}
      d={d}
      className={cn(
        "transition-[stroke-opacity,stroke-width] duration-500 motion-reduce:transition-none",
        picked || lit ? "stroke-white" : "stroke-stage-line",
      )}
      strokeOpacity={lit ? 0.95 : picked ? 0.85 : 0.35}
      strokeWidth={picked || lit ? 2 : 1.25}
    />
  );
}

export function StackDiagram() {
  const { frontend } = useFrontend();
  const [framework] = useLastFramework();
  const [ref, live, running] = useRunning();
  // CopilotKit's own agent is the middle tile, so then nothing is picked on
  // the right and the middle tile is the reader's.
  const agentPick = AGENT_POOL.some((id) => family(id) === family(framework))
    ? framework
    : undefined;
  const [[leftOffset, rightOffset], nudge] = useTurns(
    [FRONTEND_POOL, AGENT_POOL],
    [frontend, agentPick],
    running,
  );
  const fe = frontendById(frontend)?.name ?? frontend;
  const fw = frameworkById(framework)?.name ?? framework;

  const shown = (pool: string[], offset: number) =>
    ROWS.map((_, i) => pool[mod(offset + i, pool.length)]);
  const leftIds = shown(FRONTEND_POOL, leftOffset);
  const rightIds = shown(AGENT_POOL, rightOffset);
  const isFrontend = (id: string) => family(id) === family(frontend);
  const isAgent = (id: string) =>
    !!agentPick && family(id) === family(agentPick);

  const [pulse, setPulse] = useState(0);
  const { left, right, dot, lit } = useTraffic(
    live,
    {
      left: leftIds.findIndex(isFrontend),
      right: rightIds.findIndex(isAgent),
    },
    () => setPulse((n) => n + 1),
  );

  return (
    <figure
      ref={ref}
      aria-label={`Any frontend connects through CopilotKit to any agent framework. Your stack: ${fe} with ${fw}.`}
      className="relative mx-auto aspect-[440/312] w-full max-w-[440px] select-none"
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="absolute inset-0 size-full"
        aria-hidden="true"
        fill="none"
      >
        {ROWS.map((y, i) => (
          <Wire
            key={`l${y}`}
            d={`M${LEFT_X + (TILE / 2) * rowScale(i)} ${y} C 128 ${y}, 128 ${MID}, 180 ${MID}`}
            picked={isFrontend(leftIds[i])}
            lit={lit?.side === "left" && lit.row === i}
            pathRef={(el) => {
              left.current[i] = el;
            }}
          />
        ))}
        {ROWS.map((y, i) => (
          <Wire
            key={`r${y}`}
            d={`M260 ${MID} C 312 ${MID}, 312 ${y}, ${RIGHT_X - (TILE / 2) * rowScale(i)} ${y}`}
            picked={isAgent(rightIds[i])}
            lit={lit?.side === "right" && lit.row === i}
            pathRef={(el) => {
              right.current[i] = el;
            }}
          />
        ))}
        {/* The one dot in flight: a soft halo around a bright core. */}
        <g
          ref={dot}
          className="opacity-0 transition-opacity duration-200 motion-reduce:hidden"
        >
          <circle r={9} className="fill-white" fillOpacity={0.18} />
          <circle r={5} className="fill-white" fillOpacity={0.35} />
          <circle r={2.75} className="fill-white" />
        </g>
      </svg>

      <Column
        x={LEFT_X}
        pool={FRONTEND_POOL}
        offset={leftOffset}
        isPick={isFrontend}
        label={(id) => frontendById(id as FrontendId)?.name ?? id}
        logo={(id) => <FrontendLogo icon={id as FrontendId} size={22} />}
        href={(id) => frontendHref([], id as FrontendId, "")}
      />
      <Column
        x={RIGHT_X}
        pool={AGENT_POOL}
        offset={rightOffset}
        isPick={isAgent}
        label={(id) => frameworkById(id)?.name ?? id}
        logo={(id) => <FrameworkLogo slug={id} size={22} />}
        href={(id) => frameworkHref("d", id)}
      />

      {/* A soft ring as each request or reply passes through CopilotKit. */}
      {pulse > 0 ? (
        <span
          key={pulse}
          aria-hidden="true"
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 animate-[core-pulse_900ms_cubic-bezier(0.16,1,0.3,1)_forwards] rounded-[20%] border-2 border-white/80 motion-reduce:hidden"
          style={{
            left: pct(220, W),
            top: pct(MID, H),
            width: pct(80, W),
            height: pct(80, H),
          }}
        />
      ) : null}
      <Tile
        key={`core${pulse}`}
        x={220}
        y={MID}
        size={80}
        label="CopilotKit"
        className={cn(
          "rounded-[20%] border-brand-plum bg-brand-plum shadow-[0_18px_36px_rgb(20_16_33/0.28)] dark:border-white/25",
          pulse > 0 &&
            "animate-[core-beat_600ms_cubic-bezier(0.16,1,0.3,1)] motion-reduce:animate-none",
        )}
      >
        <FrameworkLogo slug="built-in-agent" size={38} />
      </Tile>

      <Arrow
        x={LEFT_X}
        y={ARROW_TOP}
        up
        label="Show the previous frontend"
        onClick={() => nudge(0, -1)}
      />
      <Arrow
        x={LEFT_X}
        y={ARROW_BOTTOM}
        up={false}
        label="Show the next frontend"
        onClick={() => nudge(0, 1)}
      />
      <Arrow
        x={RIGHT_X}
        y={ARROW_TOP}
        up
        label="Show the previous agent framework"
        onClick={() => nudge(1, -1)}
      />
      <Arrow
        x={RIGHT_X}
        y={ARROW_BOTTOM}
        up={false}
        label="Show the next agent framework"
        onClick={() => nudge(1, 1)}
      />
    </figure>
  );
}

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { FrontendLogo } from "@/components/icons/frontend-logo";
import {
  FRAMEWORKS,
  FRONTENDS,
  frameworkById,
  frontendById,
  type FrontendId,
} from "./data";
import { useFrontend } from "./frontend";
import { useLastFramework } from "./last-framework";

/*
 * The product in one picture, the way copilotkit.ai draws its protocol map:
 * frontends on the left, CopilotKit's ink tile in the middle, agent
 * frameworks on the right, as white tiles with white rims on the website's
 * stage. The reader's own stack is picked out the way the website marks its
 * selected surface (a white tile, an orange edge), and its wires are drawn
 * brighter. Every wire carries traffic: requests run out toward the agent
 * and events stream back. The other slots take turns rolling up to the next
 * frontend or framework, so the map shows every integration over time. The
 * traffic stops off screen and for reduced motion; the rolling also pauses
 * on hover.
 */
const W = 440;
const H = 264;
const ROWS = [36, 100, 164, 228];
const FRONTEND_POOL = FRONTENDS.map((f) => f.id);
// CopilotKit's own agent is the middle tile, so it isn't a slot on the right.
const AGENT_POOL = FRAMEWORKS.map((f) => f.id).filter(
  (id) => id !== "built-in-agent",
);
/** Each side rolls one slot every PERIOD; the sides alternate. */
const PERIOD = 4200;

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

/**
 * Variants that share a logo (LangGraph Python and TypeScript, React and
 * React Native, ...) count as one, so the map never shows the same mark twice.
 */
function family(id: string) {
  if (id === "react-native") return "react";
  return /^(langgraph|crewai|strands|ms|claude)-/.test(id)
    ? id.split("-")[0]
    : id;
}

/** The first four distinct marks, with the reader's pick kept on the map. */
function firstSlots(pool: string[], pick: string | undefined) {
  const slots = pick ? [pick] : [];
  for (const id of pool) {
    if (slots.length === ROWS.length) break;
    if (!slots.some((s) => family(s) === family(id))) slots.push(id);
  }
  // Keep the pool's order, so the pick sits where it would have anyway.
  return slots.sort((a, b) => pool.indexOf(a) - pool.indexOf(b));
}

/**
 * Four slots that roll, one at a time, through the pool. The pick's slot is
 * pinned; the rest take the next entries not already shown.
 */
function useRollingSlots(
  pool: string[],
  pick: string | undefined,
  running: boolean,
  offset: number,
) {
  const fresh = () => ({
    pick,
    slots: firstSlots(pool, pick),
    // Whose turn it is among the free slots, and where in the pool we are.
    turn: 0,
    cursor: ROWS.length - 1,
  });
  const [state, setState] = useState(fresh);
  // A new pick starts the map over, in render so there's no stale frame.
  if (state.pick !== pick) setState(fresh());

  useEffect(() => {
    if (!running) return;
    let interval = 0;
    const roll = () =>
      setState((s) => {
        const free = s.slots
          .map((id, i) => (id === s.pick ? -1 : i))
          .filter((i) => i >= 0);
        if (!free.length) return s;
        const slot = free[s.turn % free.length];
        for (let k = 1; k <= pool.length; k++) {
          const at = (s.cursor + k) % pool.length;
          if (!s.slots.some((id) => family(id) === family(pool[at]))) {
            const slots = [...s.slots];
            slots[slot] = pool[at];
            return { ...s, slots, turn: s.turn + 1, cursor: at };
          }
        }
        return s;
      });
    const start = window.setTimeout(() => {
      roll();
      interval = window.setInterval(roll, PERIOD);
    }, offset);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(interval);
    };
  }, [running, offset, pool]);

  return state.slots;
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

/** A logo that rolls up out of its tile as the next one rolls in. */
function Rolling({ id, children }: { id: string; children: ReactNode }) {
  const [shown, setShown] = useState({
    id,
    node: children,
    prev: null as ReactNode,
    n: 0,
  });
  if (shown.id !== id) {
    setShown({ id, node: children, prev: shown.node, n: shown.n + 1 });
  }
  useEffect(() => {
    if (!shown.prev) return;
    const t = window.setTimeout(
      () => setShown((s) => ({ ...s, prev: null })),
      600,
    );
    return () => window.clearTimeout(t);
  }, [shown.prev, shown.n]);

  const layer = "absolute inset-0 flex items-center justify-center";
  return (
    <>
      {shown.prev ? (
        <span
          key={`out${shown.n}`}
          className={`${layer} animate-[roll-out_420ms_cubic-bezier(0.22,1,0.36,1)_forwards]`}
        >
          {shown.prev}
        </span>
      ) : null}
      <span
        key={`in${shown.n}`}
        className={cn(
          layer,
          shown.n > 0 &&
            "animate-[roll-in_560ms_cubic-bezier(0.22,1,0.36,1)_both]",
        )}
      >
        {shown.node}
      </span>
    </>
  );
}

function Tile({
  x,
  y,
  size = 48,
  label,
  selected = false,
  children,
  className = "",
}: {
  x: number;
  y: number;
  size?: number;
  label: string;
  selected?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      title={label}
      className={cn(
        "absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-[24%] border-2 shadow-[0_14px_26px_rgb(31_38_36/0.12)] transition-colors duration-300 motion-reduce:transition-none",
        selected
          ? "border-brand-orange bg-white"
          : "border-stage-rim bg-stage-tile",
        className,
      )}
      style={{
        left: pct(x, W),
        top: pct(y, H),
        width: pct(size, W),
        height: pct(size, H),
      }}
    >
      {children}
    </div>
  );
}

/**
 * A wire and its traffic: one packet out toward the agent and one back, half
 * a cycle apart. `pathLength` makes a packet the same share of every wire.
 */
function Wire({
  d,
  picked,
  delay,
  live,
}: {
  d: string;
  picked: boolean;
  delay: number;
  live: boolean;
}) {
  return (
    <g>
      <path
        d={d}
        className={picked ? "stroke-white" : "stroke-stage-line opacity-40"}
        strokeWidth={picked ? 2 : 1.25}
      />
      {[0, 1].map((back) => (
        <path
          key={back}
          d={d}
          pathLength={100}
          className={cn(
            "[stroke-dasharray:9_191] [stroke-dashoffset:9] motion-safe:animate-[travel_2.6s_cubic-bezier(0.45,0,0.55,1)_infinite] motion-reduce:hidden",
            back && "[animation-direction:reverse]",
            !live && "[animation-play-state:paused]",
            picked ? "stroke-brand-plum dark:stroke-white" : "stroke-white",
          )}
          style={{ animationDelay: `${-(delay + back * 1.3)}s` }}
          strokeWidth={picked ? 3.25 : 2.5}
          strokeLinecap="round"
        />
      ))}
    </g>
  );
}

export function StackDiagram() {
  const { frontend } = useFrontend();
  const [framework] = useLastFramework();
  const [ref, live, running] = useRunning();
  // CopilotKit's own agent is the middle tile, so then nothing is pinned on
  // the right and the middle tile is the reader's.
  const agentPick = AGENT_POOL.includes(framework) ? framework : undefined;
  const frontends = useRollingSlots(
    FRONTEND_POOL,
    frontend,
    running,
    0,
  ) as FrontendId[];
  const agents = useRollingSlots(AGENT_POOL, agentPick, running, PERIOD / 2);
  const fe = frontendById(frontend)?.name ?? frontend;
  const fw = frameworkById(framework)?.name ?? framework;

  return (
    <figure
      ref={ref}
      aria-label={`Any frontend connects through CopilotKit to any agent framework. Your stack: ${fe} with ${fw}.`}
      className="relative mx-auto aspect-[440/264] w-full max-w-[440px] select-none"
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="absolute inset-0 size-full"
        aria-hidden="true"
        fill="none"
      >
        {/* The picked wires draw last, so they sit on top where wires meet. */}
        {[false, true].map((layer) =>
          ROWS.map((y, i) => {
            const left = frontends[i] === frontend;
            const right = agents[i] === agentPick;
            return (
              <g key={`${layer}${y}`}>
                {left === layer ? (
                  <Wire
                    d={`M64 ${y} C 128 ${y}, 128 132, 180 132`}
                    picked={left}
                    delay={i * 0.65}
                    live={live}
                  />
                ) : null}
                {right === layer ? (
                  <Wire
                    d={`M260 132 C 312 132, 312 ${y}, 376 ${y}`}
                    picked={right}
                    delay={i * 0.65 + 0.35}
                    live={live}
                  />
                ) : null}
              </g>
            );
          }),
        )}
      </svg>
      {frontends.map((id, i) => (
        <Tile
          key={ROWS[i]}
          x={40}
          y={ROWS[i]}
          label={frontendById(id)?.name ?? id}
          selected={id === frontend}
        >
          <Rolling id={id}>
            <FrontendLogo icon={id} size={22} />
          </Rolling>
        </Tile>
      ))}
      <Tile
        x={220}
        y={132}
        size={80}
        label="CopilotKit"
        className={cn(
          "rounded-[20%] bg-brand-plum shadow-[0_18px_36px_rgb(20_16_33/0.28)]",
          agentPick
            ? "border-brand-plum dark:border-white/25"
            : "border-brand-orange",
        )}
      >
        <FrameworkLogo slug="built-in-agent" size={38} />
      </Tile>
      {agents.map((id, i) => (
        <Tile
          key={ROWS[i]}
          x={400}
          y={ROWS[i]}
          label={frameworkById(id)?.name ?? id}
          selected={id === agentPick}
        >
          <Rolling id={id}>
            <FrameworkLogo slug={id} size={22} />
          </Rolling>
        </Tile>
      ))}
    </figure>
  );
}

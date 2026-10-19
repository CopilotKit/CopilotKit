"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  CheckSquare,
  Clapperboard,
  Eye,
  HelpCircle,
  Sparkles,
  Award,
} from "lucide-react";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";
import { KIND_LABEL, layoutJourney } from "../data/derive";
import type { Admin, ItemKind, JourneyItem } from "../data/types";

/**
 * The signature element: a journey drawn as top-to-bottom stages, with an edge
 * from every prerequisite to the item it unlocks. Positions are DERIVED from the
 * dependencies (see `layoutJourney`), never stored — so when the agent adds a
 * prerequisite, the item drops a stage on its own, and the room watches the
 * structure change rather than a list re-sort.
 *
 * Nodes touched in the last few seconds glow once and carry a chip naming who
 * touched them (the agent, or the other admin), which is how collaboration and
 * the agent's live building read from the back of a room.
 */

export const KIND_ICON: Record<
  ItemKind,
  ComponentType<{ className?: string }>
> = {
  microlesson: BookOpen,
  video: Clapperboard,
  quiz: HelpCircle,
  checklist: CheckSquare,
  observation: Eye,
  certification: Award,
};

const FRESH_MS = 6000;

interface Props {
  items: JourneyItem[];
  admins: Admin[];
  compact?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Re-render clock, so "fresh" wears off without a data change. */
  now: number;
}

export function JourneyGraph({
  items,
  admins,
  compact = false,
  selectedId,
  onSelect,
  now,
}: Props) {
  // Stages run TOP TO BOTTOM and parallel steps sit side by side. A journey is
  // deep (5–6 stages) but rarely wide (2–4 parallel steps), so this orientation
  // fits a narrow panel at a readable scale where left-to-right had to shrink
  // the text away.
  const W = compact ? 150 : 196;
  const H = compact ? 50 : 68;
  const GAP_X = compact ? 12 : 22;
  const GAP_Y = compact ? 26 : 40;
  const PAD = compact ? 10 : 20;

  const { nodes, edges, width, height } = useMemo(() => {
    const { columns: stages } = layoutJourney(items);
    const pos = new Map<string, { x: number; y: number }>();
    const widest = Math.max(1, ...stages.map((st) => st.length));
    const fullW = widest * W + (widest - 1) * GAP_X;
    stages.forEach((stage, si) => {
      const rowW = stage.length * W + (stage.length - 1) * GAP_X;
      const left = PAD + (fullW - rowW) / 2;
      stage.forEach((it, i) =>
        pos.set(it.id, {
          x: left + i * (W + GAP_X),
          y: PAD + si * (H + GAP_Y),
        }),
      );
    });
    const es: {
      key: string;
      d: string;
      delay: number;
      mx: number;
      my: number;
    }[] = [];
    for (const it of items) {
      const to = pos.get(it.id);
      if (!to) continue;
      for (const dep of it.dependsOn) {
        const from = pos.get(dep);
        if (!from) continue;
        const x1 = from.x + W / 2;
        const y1 = from.y + H;
        const x2 = to.x + W / 2;
        const y2 = to.y;
        const c = (y2 - y1) / 2;
        es.push({
          key: `${dep}->${it.id}`,
          d: `M${x1},${y1} C${x1},${y1 + c} ${x2},${y2 - c} ${x2},${y2}`,
          delay: it.delayDays,
          mx: (x1 + x2) / 2,
          my: (y1 + y2) / 2,
        });
      }
    }
    return {
      nodes: items.map((it) => ({ it, ...pos.get(it.id)! })),
      edges: es,
      width: PAD * 2 + fullW,
      height:
        PAD * 2 +
        Math.max(1, stages.length) * H +
        Math.max(0, stages.length - 1) * GAP_Y,
    };
  }, [items, W, H, GAP_X, GAP_Y, PAD]);

  if (items.length === 0) {
    return (
      <div
        className={cn(
          "my-graph-bg flex items-center justify-center rounded-lg border border-dashed border-hairline text-ink-muted",
          compact ? "h-24 text-[0.72rem]" : "h-72 text-sm",
        )}
      >
        No steps yet — ask Myelin to build this journey, or add one.
      </div>
    );
  }

  return (
    <FitToWidth
      width={width}
      height={height}
      minScale={compact ? 0.55 : 0.7}
      className={compact ? "max-h-96" : ""}
    >
      <div className="relative" style={{ width, height }}>
        <svg
          className="pointer-events-none absolute inset-0"
          width={width}
          height={height}
          aria-hidden
        >
          {edges.map((e) => (
            <g key={e.key}>
              <path
                d={e.d}
                className={cn("my-edge", e.delay > 0 && "my-edge-delay")}
              />
              {e.delay > 0 && !compact ? (
                <g transform={`translate(${e.mx},${e.my})`}>
                  <rect
                    x={-17}
                    y={-9}
                    width={34}
                    height={18}
                    rx={9}
                    className="fill-[hsl(var(--brand-soft))]"
                  />
                  <text
                    textAnchor="middle"
                    dy={4}
                    className="fill-[hsl(var(--brand))] text-[10px] font-semibold"
                  >
                    +{e.delay}d
                  </text>
                </g>
              ) : null}
            </g>
          ))}
        </svg>
        {nodes.map(({ it, x, y }) => {
          const Icon = KIND_ICON[it.kind] ?? BookOpen;
          const fresh = now - new Date(it.updatedAt).getTime() < FRESH_MS;
          const by =
            it.updatedBy === "agent"
              ? null
              : admins.find((a) => a.id === it.updatedBy);
          return (
            <button
              type="button"
              key={`${it.id}:${it.updatedAt}`}
              onClick={onSelect ? () => onSelect(it.id) : undefined}
              disabled={!onSelect}
              className={cn(
                "absolute flex flex-col rounded-lg border bg-surface text-left shadow-soft transition-colors",
                compact ? "gap-0.5 px-2 py-1.5" : "gap-1 px-3 py-2.5",
                selectedId === it.id
                  ? "border-brand ring-2 ring-brand/25"
                  : "border-hairline",
                onSelect && "hover:border-brand/60",
                fresh && "my-node-fresh",
              )}
              style={{ left: x, top: y, width: W, height: H }}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "flex shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand",
                    compact ? "h-4 w-4" : "h-5 w-5",
                  )}
                >
                  <Icon className={compact ? "h-2.5 w-2.5" : "h-3 w-3"} />
                </span>
                <span
                  className={cn(
                    "truncate font-semibold text-ink",
                    compact ? "text-[0.66rem]" : "text-[0.8rem]",
                  )}
                >
                  {it.title}
                </span>
              </span>
              <span
                className={cn(
                  "flex items-center gap-1.5 text-ink-muted",
                  compact ? "text-[0.6rem]" : "text-[0.7rem]",
                )}
              >
                <span className="my-num">{it.minutes} min</span>
                {!compact ? <span>· {KIND_LABEL[it.kind]}</span> : null}
                {!it.required ? (
                  <span className="text-brand-violet">· optional</span>
                ) : null}
              </span>
              {fresh && !compact ? (
                <span className="absolute -top-2.5 right-2 inline-flex items-center gap-1 rounded-full border border-hairline bg-surface px-1.5 py-0.5 text-[0.6rem] font-semibold text-ink shadow-soft">
                  {by ? (
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: by.color }}
                    />
                  ) : (
                    <Sparkles className="h-2.5 w-2.5 text-brand-violet" />
                  )}
                  {by ? by.name.split(" ")[0] : "Myelin"}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </FitToWidth>
  );
}

/**
 * Scale the whole map down to fit its panel (never up), so an eight-step
 * journey reads at a glance in a narrow column instead of hiding half its
 * steps behind a horizontal scrollbar. Below `minScale` it scrolls instead.
 */
function FitToWidth({
  width,
  height,
  minScale,
  className,
  children,
}: {
  width: number;
  height: number;
  minScale: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setAvailable(entry!.contentRect.width),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale =
    available > 0 ? Math.max(minScale, Math.min(1, available / width)) : 1;
  return (
    <div
      ref={ref}
      className={cn(
        "my-graph-bg overflow-auto rounded-lg border border-hairline",
        className,
      )}
    >
      <div
        className="mx-auto"
        style={{ width: width * scale, height: height * scale }}
      >
        <div
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            width,
            height,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

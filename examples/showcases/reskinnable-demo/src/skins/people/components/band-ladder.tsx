"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  bandPosition,
  formatCompact,
  formatPercent,
  formatSalary,
} from "../data/derive";
import type { Band, Employee, Level } from "../data/types";
import { Monogram } from "./monogram";

/**
 * THE BAND LADDER — Rowan's signature element.
 *
 * One vertical rail per level, each normalized to its OWN band: the bottom of a
 * rail is that band's minimum and the top is its maximum, regardless of the
 * dollar figures involved. That normalization is the whole idea. A conventional
 * comp chart plots salary on a shared money axis, which makes L7 tower over L3
 * and tells you nothing you didn't already know. Normalizing per band puts
 * every person on the same 0–100% scale, so "Priya is halfway up her band" and
 * "Arun is halfway up his" line up at the same height and become comparable at
 * a glance — which is exactly the question a People Ops lead is actually
 * asking, and exactly the shape of the preference beat 4 recalls.
 *
 * Anyone outside their band is drawn OUTSIDE the rail, in the negative colour,
 * with their name always visible. They are the actionable rows, so they are the
 * only ones that get a label without being hovered.
 */

export interface LadderPerson {
  id: string;
  name: string;
  level: Level;
  baseSalary: number;
  title: string;
  team: string;
}

interface PlacedDot {
  person: LadderPerson;
  /** Pixels above the rail's base. */
  y: number;
  /** Horizontal nudge, px, applied when dots would overlap. */
  x: number;
  ratio: number;
  outOfBand: boolean;
  side: "below" | "above" | null;
}

const COLLISION_PX = 19;
/** Cycled when dots collide, so a cluster fans out instead of stacking. */
const FAN = [0, 15, -15, 30, -30, 45, -45];

function place(
  people: LadderPerson[],
  bands: Band[],
  railHeight: number,
): PlacedDot[] {
  const dots = people
    .map((person) => {
      const pos = bandPosition(bands, person.baseSalary, person.level);
      if (!pos) return null;
      // The clamped ratio positions the dot; the raw `outOfBand` flag decides
      // whether it is pushed past the rail's end. Keeping those separate is
      // what stops clamping from quietly hiding a violation.
      //
      // 13px, not more: a below-band dot hangs into the gutter above the level
      // labels, and a larger offset drops it straight through the "L5 / Senior"
      // caption. The label block below reserves the matching space.
      const offset = pos.side === "above" ? 13 : pos.side === "below" ? -13 : 0;
      return {
        person,
        y: pos.ratio * railHeight + offset,
        x: 0,
        ratio: pos.ratio,
        outOfBand: pos.outOfBand,
        side: pos.side,
      } satisfies PlacedDot;
    })
    .filter((d): d is PlacedDot => d !== null)
    .sort((a, b) => a.y - b.y);

  // Fan out anything that would land on top of its neighbour.
  let runStart = 0;
  for (let i = 1; i <= dots.length; i += 1) {
    const breaks =
      i === dots.length || dots[i].y - dots[i - 1].y >= COLLISION_PX;
    if (!breaks) continue;
    const run = dots.slice(runStart, i);
    if (run.length > 1) {
      run.forEach((dot, idx) => {
        dot.x = FAN[idx % FAN.length];
      });
    }
    runStart = i;
  }
  return dots;
}

export function BandLadder({
  bands,
  employees,
  compact = false,
  highlightIds,
  className,
}: {
  bands: Band[];
  employees: Employee[];
  /** Narrow variant for the chat transcript. */
  compact?: boolean;
  /** Draw a brand ring on these people — the ones a tool just touched. */
  highlightIds?: string[];
  className?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const railHeight = compact ? 160 : 232;
  const highlighted = useMemo(
    () => new Set(highlightIds ?? []),
    [highlightIds],
  );

  const columns = useMemo(
    () =>
      bands.map((band) => ({
        band,
        dots: place(
          employees
            .filter((e) => e.level === band.level)
            .map((e) => ({
              id: e.id,
              name: e.name,
              level: e.level,
              baseSalary: e.baseSalary,
              title: e.title,
              team: e.team,
            })),
          bands,
          railHeight,
        ),
      })),
    [bands, employees, railHeight],
  );

  const outOfBandCount = columns.reduce(
    (sum, c) => sum + c.dots.filter((d) => d.outOfBand).length,
    0,
  );

  return (
    <figure className={cn("w-full", className)}>
      <div
        className="flex items-end gap-1"
        // Rail + the mt-5 gutter a below-band dot hangs into + the caption
        // block (two lines compact, three with the band range).
        style={{ height: railHeight + (compact ? 58 : 78) }}
      >
        {columns.map(({ band, dots }) => (
          <div
            key={band.level}
            className="flex min-w-0 flex-1 flex-col items-center"
          >
            <div className="relative w-full" style={{ height: railHeight }}>
              {/* The rail. `.rowan-rail` carries the band gradient so it tracks
                  the live theme tokens rather than a hard-coded colour. */}
              <div
                className="rowan-rail absolute left-1/2 top-0 h-full w-2.5 -translate-x-1/2 rounded-full"
                aria-hidden
              />
              {/* The ceiling cap — the one place a rail earns colour. */}
              <div
                className="rowan-rail-cap absolute left-1/2 top-0 h-1 w-2.5 -translate-x-1/2 rounded-full"
                aria-hidden
              />
              {/* Midpoint tick — the band target. */}
              <div
                className="absolute left-1/2 w-7 -translate-x-1/2 border-t border-dashed border-ink-muted/40"
                style={{
                  bottom:
                    ((band.mid - band.min) / (band.max - band.min)) *
                    railHeight,
                }}
                aria-hidden
              />
              {dots.map((dot) => {
                const isHovered = hovered === dot.person.id;
                return (
                  <button
                    key={dot.person.id}
                    type="button"
                    onMouseEnter={() => setHovered(dot.person.id)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(dot.person.id)}
                    onBlur={() => setHovered(null)}
                    aria-label={`${dot.person.name}, ${dot.person.level}, ${formatSalary(
                      dot.person.baseSalary,
                    )}${dot.outOfBand ? `, ${dot.side} band` : ""}`}
                    className="absolute left-1/2 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    style={{
                      bottom: dot.y,
                      // Both axes in ONE inline transform: a Tailwind
                      // `-translate-x-1/2` would be overwritten by this style
                      // rather than composed with it, which silently shifts
                      // every dot half its width off the rail.
                      transform: `translate(calc(-50% + ${dot.x}px), 50%)`,
                      zIndex: isHovered ? 30 : dot.outOfBand ? 20 : 10,
                    }}
                  >
                    <span
                      className={cn(
                        "block rounded-full border-2 transition-transform",
                        compact ? "h-2.5 w-2.5" : "h-3 w-3",
                        // Full-strength plum with a surface-coloured border: at
                        // 70% opacity these disappeared into their own rail,
                        // which is the one thing a dot on a rail must not do.
                        dot.outOfBand
                          ? "rowan-flag border-surface bg-negative"
                          : highlighted.has(dot.person.id)
                            ? "border-brand-violet bg-brand"
                            : "border-surface bg-brand",
                        isHovered && "scale-150",
                      )}
                    />
                  </button>
                );
              })}

              {/* Out-of-band names are always visible: they are the rows anyone
                  is actually here to act on. Everyone else labels on hover. */}
              {!compact &&
                dots
                  .filter((d) => d.outOfBand)
                  .map((dot) => (
                    <span
                      key={`${dot.person.id}-label`}
                      className="rowan-num pointer-events-none absolute left-1/2 translate-x-4 whitespace-nowrap text-[0.65rem] font-semibold text-negative"
                      style={{ bottom: dot.y - 6 }}
                    >
                      {dot.person.name.split(" ")[0]}
                    </span>
                  ))}
            </div>

            {/* mt-5 reserves the gutter a below-band dot hangs into. */}
            <div className="mt-5 text-center">
              <div className="text-[0.72rem] font-semibold text-ink">
                {band.level}
              </div>
              <div className="text-[0.62rem] text-ink-muted">{band.label}</div>
              {!compact ? (
                <div className="rowan-num mt-0.5 text-[0.6rem] text-ink-muted">
                  {formatCompact(band.min)}–{formatCompact(band.max)}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {/* Hover detail. A fixed slot rather than a floating tooltip, so the
          ladder never reflows and never clips inside the chat column. */}
      <div className="mt-3 flex min-h-[2.25rem] items-center justify-between gap-3 rounded-md border border-hairline bg-surface-muted px-3 py-1.5">
        {hovered ? (
          (() => {
            const dot = columns
              .flatMap((c) => c.dots)
              .find((d) => d.person.id === hovered);
            if (!dot) return null;
            return (
              <>
                <span className="flex min-w-0 items-center gap-2">
                  <Monogram name={dot.person.name} size="xs" />
                  <span className="truncate text-[0.75rem] font-medium text-ink">
                    {dot.person.name}
                  </span>
                  <span className="hidden truncate text-[0.7rem] text-ink-muted sm:inline">
                    {dot.person.title}
                  </span>
                </span>
                <span className="rowan-num shrink-0 text-[0.72rem] font-semibold text-ink">
                  {formatSalary(dot.person.baseSalary)}
                  <span
                    className={cn(
                      "ml-2 font-medium",
                      dot.outOfBand ? "text-negative" : "text-ink-muted",
                    )}
                  >
                    {dot.outOfBand
                      ? `${dot.side} band`
                      : `${formatPercent(dot.ratio)} of band`}
                  </span>
                </span>
              </>
            );
          })()
        ) : (
          <span className="text-[0.72rem] text-ink-muted">
            {outOfBandCount === 0
              ? "Everyone is inside their band."
              : `${outOfBandCount} ${outOfBandCount === 1 ? "person is" : "people are"} outside their band — shown in red, outside the rail.`}
          </span>
        )}
      </div>
      <figcaption className="sr-only">
        Compensation band ladder. Each level is a rail from its band minimum to
        its band maximum; each dot is one person at their position in that band.
      </figcaption>
    </figure>
  );
}

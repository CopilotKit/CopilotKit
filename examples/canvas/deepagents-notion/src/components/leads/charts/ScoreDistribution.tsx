"use client";

/**
 * ScoreDistribution — histogram of lead scores 0..100 in 10 buckets.
 *
 * Visual:
 *   - 10 vertical bars (0–9, 10–19, …, 90–100)
 *   - Each bar is segmented by tier color so the tier bands become readable
 *     across the score axis (e.g. you see Hot bunching up on the right)
 *   - Bar height encodes count; mouse-hover reveals exact count + range
 *   - X axis ticks at 0 / 50 / 100; no Y axis (numbers above bars)
 *
 * Caller passes pre-bucketed counts. Helper `bucketScores()` provided for
 * convenience if you have an array of {score, tier}.
 */

import { motion } from "motion/react";
import type { Tier } from "@/lib/leads/types";

export interface ScoreBucket {
  /** Lower bound, inclusive (0, 10, 20, …, 90). */
  start: number;
  /** Upper bound, exclusive except for the last bucket (10, 20, …, 101). */
  end: number;
  /** Count per tier inside this bucket. */
  byTier: Record<Tier, number>;
}

export interface ScoreDistributionProps {
  buckets: ScoreBucket[];
  /** Defaults to ~360 wide × 140 tall — fits in chat or LeadDetail. */
  width?: number;
  height?: number;
  className?: string;
}

const TIER_ORDER: Tier[] = ["drop", "nurture", "warm", "hot"]; // stack low→high

const TIER_COLOR: Record<Tier, string> = {
  hot: "#f43f5e",
  warm: "#f59e0b",
  nurture: "#0ea5e9",
  drop: "#94a3b8",
};

export function ScoreDistribution({
  buckets,
  width = 360,
  height = 140,
  className,
}: ScoreDistributionProps) {
  const padX = 18;
  const padTop = 12;
  const padBottom = 24;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;
  const barWidth = innerW / buckets.length;
  const barGap = barWidth * 0.18;

  const max = Math.max(
    1,
    ...buckets.map((b) => sumBucket(b)),
  );

  return (
    <div
      className={`rounded-xl border border-border bg-card p-3 shadow-sm ${className ?? ""}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Score distribution
        </span>
        <ul className="flex items-center gap-2 text-[9px]">
          {(["hot", "warm", "nurture", "drop"] as Tier[]).map((t) => (
            <li key={t} className="flex items-center gap-1 text-muted-foreground">
              <span
                className="size-2 rounded-full"
                style={{ background: TIER_COLOR[t] }}
              />
              {t}
            </li>
          ))}
        </ul>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label="Histogram of lead scores"
      >
        {/* Y baseline */}
        <line
          x1={padX}
          y1={padTop + innerH}
          x2={padX + innerW}
          y2={padTop + innerH}
          stroke="var(--color-border)"
          strokeWidth={1}
        />

        {/* Bars (stacked by tier) */}
        {buckets.map((bucket, i) => {
          const total = sumBucket(bucket);
          if (total === 0) return null;
          const barX = padX + i * barWidth + barGap / 2;
          const drawW = barWidth - barGap;
          const fullH = (total / max) * innerH;

          // Stack tiers bottom-up
          let yCursor = padTop + innerH;
          const segs: { tier: Tier; y: number; h: number }[] = [];
          for (const tier of TIER_ORDER) {
            const v = bucket.byTier[tier] ?? 0;
            if (v === 0) continue;
            const segH = (v / total) * fullH;
            yCursor -= segH;
            segs.push({ tier, y: yCursor, h: segH });
          }

          return (
            <g key={`${bucket.start}-${bucket.end}`}>
              {segs.map((seg, idx) => (
                <motion.rect
                  key={`${seg.tier}-${idx}`}
                  x={barX}
                  y={seg.y}
                  width={drawW}
                  height={seg.h}
                  fill={TIER_COLOR[seg.tier]}
                  rx={2}
                  initial={{ opacity: 0, y: padTop + innerH }}
                  animate={{ opacity: 1, y: seg.y }}
                  transition={{
                    duration: 0.4,
                    delay: i * 0.02,
                    ease: "easeOut",
                  }}
                >
                  <title>
                    {`${bucket.start}–${bucket.end - 1}: ${
                      bucket.byTier[seg.tier]
                    } ${seg.tier}`}
                  </title>
                </motion.rect>
              ))}
              {/* Count label above bar */}
              <text
                x={barX + drawW / 2}
                y={padTop + innerH - fullH - 4}
                textAnchor="middle"
                className="fill-muted-foreground font-mono text-[9px] tabular-nums"
              >
                {total}
              </text>
            </g>
          );
        })}

        {/* X ticks at 0 / 50 / 100 */}
        {[0, 50, 100].map((tick) => {
          const x = padX + (tick / 100) * innerW;
          return (
            <text
              key={tick}
              x={x}
              y={padTop + innerH + 14}
              textAnchor="middle"
              className="fill-muted-foreground font-mono text-[9px]"
            >
              {tick}
            </text>
          );
        })}
        <text
          x={padX + innerW / 2}
          y={padTop + innerH + 22}
          textAnchor="middle"
          className="fill-muted-foreground text-[9px] uppercase tracking-widest"
        >
          score
        </text>
      </svg>
    </div>
  );
}

function sumBucket(b: ScoreBucket): number {
  return TIER_ORDER.reduce((acc, t) => acc + (b.byTier[t] ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Helper: build buckets from a flat array of {score, tier}
// ---------------------------------------------------------------------------

export function bucketScores(
  rows: { score: number; tier: Tier }[],
): ScoreBucket[] {
  const buckets: ScoreBucket[] = [];
  for (let start = 0; start < 100; start += 10) {
    buckets.push({
      start,
      end: start + 10,
      byTier: { hot: 0, warm: 0, nurture: 0, drop: 0 },
    });
  }
  for (const r of rows) {
    const idx = Math.min(9, Math.max(0, Math.floor(r.score / 10)));
    buckets[idx].byTier[r.tier] += 1;
  }
  // Bucket 9 is 90..100 (inclusive of 100)
  buckets[9].end = 101;
  return buckets;
}

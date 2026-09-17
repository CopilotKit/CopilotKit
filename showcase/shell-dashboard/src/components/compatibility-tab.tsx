"use client";

import { useMemo, useState } from "react";
import { getIntegrations } from "@/lib/registry";
import type { CompatibilityFilter } from "@/lib/compatibility";
import {
  COMPATIBILITY_SNAPSHOT,
  filterCompatibilityPlatforms,
  getCompatibilityPlatforms,
} from "@/lib/compatibility";
import { CompatibilityGrid } from "./compatibility-grid";

const buttonStyle =
  "cursor-pointer rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]";

export function CompatibilityTab() {
  const platforms = useMemo(
    () => getCompatibilityPlatforms(getIntegrations()),
    [],
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CompatibilityFilter>("all");
  const [expanded, setExpanded] = useState(new Set<string>());
  const visible = filterCompatibilityPlatforms(platforms, query, filter);
  const variants = platforms.flatMap((platform) => platform.variants);
  const assessed = variants.filter((variant) => variant.assessment !== null);
  const behind = assessed.filter((variant) => variant.assessment!.score < 100);
  const packageCount = assessed.reduce(
    (sum, variant) => sum + variant.assessment!.packages.length,
    0,
  );
  const filters: { id: CompatibilityFilter; label: string; count: number }[] = [
    { id: "all", label: "All platforms", count: platforms.length },
    {
      id: "assessed",
      label: "Assessed",
      count: filterCompatibilityPlatforms(platforms, "", "assessed").length,
    },
    {
      id: "upgrade",
      label: "Needs upgrade",
      count: filterCompatibilityPlatforms(platforms, "", "upgrade").length,
    },
  ];

  function togglePlatform(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section
      aria-label="Compatibility"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--bg-surface)] px-4 py-5 sm:px-8">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-medium">
          <span className="rounded border border-[var(--border)] bg-[var(--bg-muted)] px-2 py-0.5 uppercase tracking-wider text-[var(--text-secondary)]">
            Prototype
          </span>
          <span className="text-[var(--text-secondary)]">
            {COMPATIBILITY_SNAPSHOT.date} snapshot
          </span>
          <a
            href={COMPATIBILITY_SNAPSHOT.source}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-[var(--accent)] hover:underline"
          >
            View source scorecard ↗
          </a>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Compatibility</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[var(--text-secondary)]">
          How current are the SDKs powering Showcase? Expand a platform to
          compare its SDK packages. Versions and scores reflect the assessment
          date.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-xs">
          <div>
            <span className="font-semibold tabular-nums">
              {assessed.length}
              <span className="font-normal text-[var(--text-muted)]">
                {" "}
                / {variants.length}
              </span>
            </span>{" "}
            <span className="text-[var(--text-secondary)]">
              variants assessed
            </span>
          </div>
          <div>
            <span className="font-semibold tabular-nums">{packageCount}</span>{" "}
            <span className="text-[var(--text-secondary)]">
              SDK packages recorded
            </span>
          </div>
          <div>
            <span className="font-semibold tabular-nums text-[var(--amber)]">
              {behind.length}
            </span>{" "}
            <span className="text-[var(--text-secondary)]">
              variants behind target
            </span>
          </div>
          <div>
            <span className="font-semibold tabular-nums text-[var(--text-secondary)]">
              {variants.length - assessed.length}
            </span>{" "}
            <span className="text-[var(--text-secondary)]">not assessed</span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 sm:px-8">
        <input
          type="search"
          aria-label="Find a platform or SDK"
          placeholder="Find a platform or SDK…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 basis-full flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] sm:basis-auto sm:max-w-[260px]"
        />
        <div className="flex items-center gap-1" aria-label="Platform filters">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
              className={`cursor-pointer rounded-md px-2.5 py-1.5 text-[11px] font-medium focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${filter === item.id ? "bg-[var(--bg-muted)] text-[var(--text)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"}`}
            >
              {item.label}{" "}
              <span className="ml-1 text-[10px] text-[var(--text-muted)]">
                {item.count}
              </span>
            </button>
          ))}
        </div>
        <div className="flex gap-2 sm:ml-auto">
          <button
            type="button"
            className={buttonStyle}
            onClick={() =>
              setExpanded(
                (prev) =>
                  new Set([...prev, ...visible.map((platform) => platform.id)]),
              )
            }
          >
            Expand SDKs
          </button>
          <button
            type="button"
            className={buttonStyle}
            onClick={() => setExpanded(new Set())}
          >
            Collapse all
          </button>
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto"
        role="region"
        aria-label="Compatibility matrix"
        tabIndex={0}
      >
        {visible.length > 0 ? (
          <CompatibilityGrid
            platforms={visible}
            expanded={expanded}
            onToggle={togglePlatform}
          />
        ) : (
          <div className="px-8 py-16 text-center">
            <h2 className="text-sm font-semibold">No matching platforms</h2>
            <p className="my-2 text-xs text-[var(--text-secondary)]">
              Try another platform, SDK package, or filter.
            </p>
            <button
              type="button"
              className={buttonStyle}
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      <details className="shrink-0 border-t border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-xs sm:px-8">
        <summary className="cursor-pointer text-[var(--text-secondary)]">
          How compatibility is scored{" "}
          <span className="ml-2 text-[10px] text-[var(--text-muted)]">
            30-day grace · patch releases carry no penalty
          </span>
        </summary>
        <div className="mt-3 max-h-40 space-y-2 overflow-auto text-[11px] leading-relaxed text-[var(--text-secondary)]">
          <p>
            Current line: 100. One / two / three minor lines behind: 90 / 80 /
            70. Four or more minors behind: 60. One major behind: 20. Two or
            more majors behind: 5.
          </p>
          <p>
            Each variant takes the lowest score among its required SDK packages.
            Python, TypeScript, .NET, and other variants keep separate scores. A
            currency score describes version freshness; successful execution
            requires separate evidence.
          </p>
          <p>
            A verified newer supported version can earn limited credit. This
            snapshot includes no tested-ceiling detail or comparable history.
            Microsoft release targets are shown at the precision reported by the
            source.
          </p>
          <a
            href={COMPATIBILITY_SNAPSHOT.methodology}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-[var(--accent)] hover:underline"
          >
            Read the scoring methodology ↗
          </a>
        </div>
      </details>
    </section>
  );
}

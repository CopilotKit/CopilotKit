"use client";

import { Fragment, useState } from "react";
import type {
  CompatibilityPlatform,
  CompatibilityVariant,
  SdkAssessment,
} from "@/lib/compatibility";
import { COMPATIBILITY_SNAPSHOT } from "@/lib/compatibility";

type Metric =
  | "score"
  | "currency"
  | "opportunity"
  | "package"
  | "running"
  | "graceTarget"
  | "latest"
  | "assessed"
  | "ceiling"
  | "trend"
  | "source";

const sections: {
  name: string;
  rows: { id: Metric; label: string; hint: string }[];
}[] = [
  {
    name: "Compatibility",
    rows: [
      {
        id: "score",
        label: "Compatibility score",
        hint: "Each variant uses its lowest required SDK package score. Variants are never averaged.",
      },
      {
        id: "currency",
        label: "SDK currency",
        hint: "Currency at the assessment date, after the 30-day release grace period.",
      },
      {
        id: "opportunity",
        label: "Available improvement",
        hint: "Compatibility points available by bringing the required SDK packages to the grace target.",
      },
    ],
  },
  {
    name: "SDK versions",
    rows: [
      {
        id: "package",
        label: "Required SDK package",
        hint: "Independently versioned framework packages recorded in the assessment.",
      },
      {
        id: "running",
        label: "Running version",
        hint: "The exact Showcase version recorded on the assessment date.",
      },
      {
        id: "graceTarget",
        label: "Grace target",
        hint: "The release target after allowing 30 days for adoption.",
      },
      {
        id: "latest",
        label: "Latest available",
        hint: "Latest available at assessment time, not a live registry lookup.",
      },
    ],
  },
  {
    name: "Assessment evidence",
    rows: [
      {
        id: "assessed",
        label: "Assessed on",
        hint: "When the package facts were assessed.",
      },
      {
        id: "ceiling",
        label: "Newer tested version",
        hint: "A separately tested newer version; no ceiling evidence was included in this snapshot.",
      },
      {
        id: "trend",
        label: "90-day trend",
        hint: "Comparable history is required before a trend can be shown.",
      },
      {
        id: "source",
        label: "Source",
        hint: "The original assessment and scoring rubric.",
      },
    ],
  },
];

function Score({ value }: { value: number }) {
  const color =
    value === 100
      ? "var(--ok)"
      : value >= 60
        ? "var(--amber)"
        : "var(--danger)";
  return (
    <span
      className="inline-flex items-baseline gap-1.5 tabular-nums"
      style={{ color }}
    >
      <span className="text-2xl font-semibold tracking-tight">{value}</span>
      <span className="text-[10px] text-[var(--text-muted)]">/ 100</span>
    </span>
  );
}

function MetricValue({
  metric,
  variant,
  sdk,
}: {
  metric: Metric;
  variant: CompatibilityVariant;
  sdk?: SdkAssessment;
}) {
  const assessment = variant.assessment;
  if (!assessment)
    return <span className="text-[var(--text-muted)]">Not assessed</span>;
  const score = sdk?.score ?? assessment.score;
  switch (metric) {
    case "score":
      return <Score value={score} />;
    case "currency":
      return (
        <span
          className="inline-flex items-center gap-1.5 text-[11px]"
          style={{ color: score === 100 ? "var(--ok)" : "var(--amber)" }}
        >
          <span aria-hidden>{score === 100 ? "✓" : "↗"}</span>
          {score === 100 ? "Within grace target" : "4+ minor lines behind"}
        </span>
      );
    case "opportunity":
      return score === 100 ? (
        <span className="text-[var(--text-muted)]">At target</span>
      ) : (
        <span className="font-medium text-[var(--accent)]">
          +{100 - score} compatibility points
        </span>
      );
    case "package":
      return sdk ? (
        <span className="break-words font-mono text-[11px]">{sdk.name}</span>
      ) : (
        <span>
          {assessment.packages.length} required SDK
          {assessment.packages.length === 1 ? "" : "s"}
        </span>
      );
    case "running":
    case "graceTarget":
    case "latest": {
      const pkg =
        sdk ??
        (assessment.packages.length === 1 ? assessment.packages[0] : undefined);
      if (!pkg)
        return (
          <span className="text-[var(--text-secondary)]">
            {assessment.packages.length} versions · expand SDKs
          </span>
        );
      return (
        <div>
          <span className="break-words font-mono text-[11px]">
            {pkg[metric]}
          </span>
          {metric !== "running" && pkg.targetsAreReleaseLines && (
            <div className="mt-1 text-[10px] text-[var(--text-muted)]">
              Release line reported
            </div>
          )}
        </div>
      );
    }
    case "assessed":
      return (
        <time dateTime={COMPATIBILITY_SNAPSHOT.assessedAt}>Aug 19, 2026</time>
      );
    case "ceiling":
      return <span className="text-[var(--text-muted)]">Not recorded</span>;
    case "trend":
      return <span className="text-[var(--text-muted)]">Initial baseline</span>;
    case "source":
      return (
        <a
          className="text-[var(--accent)] underline-offset-2 hover:underline"
          href={COMPATIBILITY_SNAPSHOT.source}
          target="_blank"
          rel="noreferrer"
        >
          Scorecard v2 ↗
        </a>
      );
  }
}

interface Column {
  key: string;
  platform: CompatibilityPlatform;
  variant?: CompatibilityVariant;
  sdk?: SdkAssessment;
}

export function CompatibilityGrid({
  platforms,
  expanded,
  onToggle,
}: {
  platforms: CompatibilityPlatform[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [collapsedSections, setCollapsedSections] = useState(new Set<string>());
  const groups = platforms.map((platform) => {
    const columns: Column[] = [{ key: platform.id, platform }];
    if (expanded.has(platform.id)) {
      for (const variant of platform.variants) {
        const packages = variant.assessment?.packages;
        if (packages?.length) {
          for (const sdk of packages)
            columns.push({
              key: `${variant.slug}:${sdk.name}`,
              platform,
              variant,
              sdk,
            });
        } else
          columns.push({
            key: `${variant.slug}:unassessed`,
            platform,
            variant,
          });
      }
    }
    return { platform, columns };
  });
  const columns = groups.flatMap((group) => group.columns);

  return (
    <table
      className="border-separate border-spacing-0 text-left text-xs"
      style={{ width: 210 + columns.length * 240, tableLayout: "fixed" }}
    >
      <caption className="sr-only">
        Framework SDK compatibility — August 19, 2026 snapshot. Platforms expand
        horizontally into SDK package columns.
      </caption>
      <colgroup>
        <col style={{ width: 210 }} />
        {columns.map((column) => (
          <col key={column.key} style={{ width: 240 }} />
        ))}
      </colgroup>
      <thead className="sticky top-0 z-20">
        <tr>
          <th
            scope="col"
            className="sticky left-0 z-30 border-b border-r border-[var(--border)] bg-[var(--bg-muted)] px-5 py-4 text-[10px] font-medium uppercase tracking-wider text-[var(--text-secondary)]"
          >
            Platform
          </th>
          {groups.map(({ platform, columns: groupColumns }) => (
            <th
              key={platform.id}
              scope="colgroup"
              colSpan={groupColumns.length}
              className="border-b border-r border-[var(--border-strong)] bg-[var(--bg-muted)] p-0 align-top"
            >
              <button
                type="button"
                aria-label={`${expanded.has(platform.id) ? "Collapse" : "Expand"} ${platform.name} SDKs`}
                aria-expanded={expanded.has(platform.id)}
                onClick={() => onToggle(platform.id)}
                className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-4 text-left hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--accent)]"
              >
                <span className="text-xs font-semibold">{platform.name}</span>
                <span className="shrink-0 text-[10px] font-medium text-[var(--accent)]">
                  {expanded.has(platform.id) ? "− Hide SDKs" : "+ SDKs"}
                </span>
              </button>
            </th>
          ))}
        </tr>
        <tr>
          <th
            scope="col"
            className="sticky left-0 z-30 border-b border-r border-[var(--border)] bg-[var(--bg-surface)] px-5 py-3 text-[10px] font-medium uppercase tracking-wider text-[var(--text-secondary)]"
          >
            Metric
          </th>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className={`border-b border-r border-[var(--border)] px-4 py-3 align-top font-normal ${column.variant ? "bg-[var(--bg-muted)]" : "bg-[var(--bg-surface)]"}`}
            >
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                {column.variant?.label ?? "Overview"}
              </div>
              {column.variant ? (
                <div className="break-words font-mono text-[11px] leading-relaxed">
                  {column.sdk?.name ?? "SDK inventory not assessed"}
                </div>
              ) : (
                <div className="text-[11px] text-[var(--text-muted)]">
                  {column.platform.variants.length} variant
                  {column.platform.variants.length === 1 ? "" : "s"} ·
                  individual scores
                </div>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sections.map((section) => {
          const open = !collapsedSections.has(section.name);
          return (
            <Fragment key={section.name}>
              <tr>
                <th
                  colSpan={columns.length + 1}
                  className="border-b border-[var(--border)] bg-[var(--bg-muted)] p-0"
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() =>
                      setCollapsedSections((prev) => {
                        const next = new Set(prev);
                        if (next.has(section.name)) next.delete(section.name);
                        else next.add(section.name);
                        return next;
                      })
                    }
                    className="sticky left-0 flex w-[210px] cursor-pointer items-center gap-2 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text)]"
                  >
                    <span aria-hidden>{open ? "⌄" : "›"}</span>
                    {section.name}
                  </button>
                </th>
              </tr>
              {open &&
                section.rows.map((row) => (
                  <tr key={row.id} className="grid-row">
                    <th
                      scope="row"
                      title={row.hint}
                      className="sticky left-0 z-10 border-b border-r border-[var(--border)] bg-[var(--bg-surface)] px-5 py-4 align-top text-[11px] font-medium text-[var(--text-secondary)]"
                    >
                      {row.label}
                    </th>
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className="border-b border-r border-[var(--border)] bg-[var(--bg)] px-4 py-3 align-top"
                        data-testid={
                          row.id === "score" && !column.variant
                            ? `compatibility-summary-${column.platform.id}`
                            : undefined
                        }
                      >
                        {column.variant ? (
                          <MetricValue
                            metric={row.id}
                            variant={column.variant}
                            sdk={column.sdk}
                          />
                        ) : (
                          <div className="space-y-3">
                            {column.platform.variants.map((variant) => (
                              <div key={variant.slug}>
                                {column.platform.variants.length > 1 && (
                                  <div className="mb-1 text-[10px] text-[var(--text-secondary)]">
                                    {variant.label}
                                  </div>
                                )}
                                <MetricValue
                                  metric={row.id}
                                  variant={variant}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

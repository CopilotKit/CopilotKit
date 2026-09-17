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
  | "package"
  | "runningVersion"
  | "graceTarget"
  | "latest"
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
        label: "Compatibility",
        hint: "Current score when comparable SDK package versions are available.",
      },
    ],
  },
  {
    name: "SDK versions",
    rows: [
      {
        id: "package",
        label: "SDK package",
        hint: "Framework and adapter packages recorded in the package inventory.",
      },
      {
        id: "runningVersion",
        label: "Running version",
        hint: "SDK or package version used for this snapshot when available.",
      },
      {
        id: "graceTarget",
        label: "Grace target",
        hint: "The release target after allowing 30 days for adoption.",
      },
      {
        id: "latest",
        label: "Latest",
        hint: "Latest available at assessment time, not a live registry lookup.",
      },
      {
        id: "source",
        label: "Registry",
        hint: "Current registry fact source for package versions.",
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

function EmptyValue({ children }: { children: string }) {
  return <span className="text-[var(--text-muted)]">{children}</span>;
}

function VersionValue({
  value,
  emptyLabel,
}: {
  value: string | null;
  emptyLabel: string;
}) {
  return value ? (
    <span className="break-words font-mono text-[11px]">{value}</span>
  ) : (
    <EmptyValue>{emptyLabel}</EmptyValue>
  );
}

function PackageValue({ sdk }: { sdk?: SdkAssessment }) {
  if (!sdk) return null;
  return (
    <div>
      <span className="break-words font-mono text-[11px]">{sdk.name}</span>
      <div className="mt-1 text-[10px] capitalize text-[var(--text-muted)]">
        {sdk.role.replaceAll("_", " ")}
      </div>
    </div>
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
  switch (metric) {
    case "score":
      if (sdk) return <EmptyValue>—</EmptyValue>;
      return assessment.currentScore === null ? (
        <EmptyValue>{assessment.label}</EmptyValue>
      ) : (
        <Score value={assessment.currentScore} />
      );
    case "package":
      return sdk ? (
        <PackageValue sdk={sdk} />
      ) : (
        <span>
          {assessment.packages.length} package
          {assessment.packages.length === 1 ? "" : "s"}
        </span>
      );
    case "runningVersion": {
      const pkg =
        sdk ??
        (assessment.packages.length === 1 ? assessment.packages[0] : undefined);
      return pkg ? (
        <VersionValue value={pkg.runningVersion} emptyLabel="Not verified" />
      ) : (
        <span className="text-[var(--text-secondary)]">
          {assessment.packages.length} versions · expand SDKs
        </span>
      );
    }
    case "graceTarget":
    case "latest": {
      const pkg =
        sdk ??
        (assessment.packages.length === 1 ? assessment.packages[0] : undefined);
      return pkg ? (
        <VersionValue value={pkg[metric]} emptyLabel="Not available" />
      ) : (
        <span className="text-[var(--text-secondary)]">
          {assessment.packages.length} versions · expand SDKs
        </span>
      );
    }
    case "source": {
      const pkg =
        sdk ??
        (assessment.packages.length === 1 ? assessment.packages[0] : undefined);
      if (!pkg) return <EmptyValue>Expand SDKs</EmptyValue>;
      if (!pkg.sourceUrl) return <EmptyValue>Not available</EmptyValue>;
      return (
        <a
          className="text-[var(--accent)] underline-offset-2 hover:underline"
          href={pkg.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          Registry
        </a>
      );
    }
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
        for (const sdk of variant.assessment.packages) {
          columns.push({
            key: `${variant.slug}:${sdk.name}`,
            platform,
            variant,
            sdk,
          });
        }
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
        Framework SDK compatibility — {COMPATIBILITY_SNAPSHOT.date} snapshot.
        Platforms expand horizontally into SDK package columns.
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
                  {expanded.has(platform.id) ? "- Hide SDKs" : "+ SDKs"}
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
                  {column.sdk?.name}
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

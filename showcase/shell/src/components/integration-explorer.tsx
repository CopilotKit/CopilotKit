"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { type Integration, getCategoryLabel } from "@/lib/registry";
import constraintsData from "@/data/constraints.json";

// Module-scope: stable reference, no useMemo needed
const constraints = constraintsData as {
  generative_ui: Record<string, { allowed?: string[]; excluded?: string[] }>;
  interaction_modalities: Record<
    string,
    { allowed?: string[]; excluded?: string[] }
  >;
};

const GEN_UI_LABELS: Record<string, string> = {
  "constrained-declarative": "Declarative",
  "constrained-explicit": "Explicitly Specified",
  open: "Open",
};

const MODALITY_LABELS: Record<string, string> = {
  sidebar: "Sidebar",
  embedded: "Embedded",
  popup: "Popup",
  chat: "Chat",
  headless: "Headless",
};

const GEN_UI_VALUES = Object.keys(GEN_UI_LABELS);
const MODALITY_VALUES = Object.keys(MODALITY_LABELS);

const CATEGORY_ORDER = [
  "popular",
  "agent-framework",
  "enterprise-platform",
  "provider-sdk",
  "protocol",
  "emerging",
  "starter",
];

interface IntegrationExplorerProps {
  integrations: Integration[];
  initialFeatureFilter?: string;
}

interface FilteredDemo {
  integration: Integration;
  demo: Integration["demos"][number];
}

export function IntegrationExplorer({
  integrations,
  initialFeatureFilter,
}: IntegrationExplorerProps) {
  const [framework, setFramework] = useState("all");
  const [genUi, setGenUi] = useState("all");
  const [modality, setModality] = useState("all");
  const [featureFilter, setFeatureFilter] = useState(
    initialFeatureFilter ?? "",
  );

  // Only deployed integrations participate in filtering
  const deployed = useMemo(
    () => integrations.filter((i) => i.deployed),
    [integrations],
  );

  // Unique framework names from deployed integrations
  const frameworkOptions = useMemo(() => {
    // Preserve registry sort_order (not alphabetical)
    const seen = new Set<string>();
    return deployed
      .filter((i) => {
        if (seen.has(i.name)) return false;
        seen.add(i.name);
        return true;
      })
      .map((i) => i.name);
  }, [deployed]);

  // Coming-soon frameworks: present in integrations but not deployed
  const comingSoonFrameworks = useMemo(() => {
    const deployedNames = new Set(deployed.map((i) => i.name));
    const allNames = new Set(integrations.map((i) => i.name));
    return new Set([...allNames].filter((n) => !deployedNames.has(n)));
  }, [integrations, deployed]);

  // Determine "coming soon" enum values: those with no deployed packages
  const comingSoonGenUi = useMemo(() => {
    const available = new Set(deployed.flatMap((i) => i.generative_ui ?? []));
    return new Set(GEN_UI_VALUES.filter((v) => !available.has(v)));
  }, [deployed]);

  const comingSoonModality = useMemo(() => {
    const available = new Set(
      deployed.flatMap((i) => i.interaction_modalities ?? []),
    );
    return new Set(MODALITY_VALUES.filter((v) => !available.has(v)));
  }, [deployed]);

  // Count demos per framework (deployed only)
  const frameworkCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of deployed) {
      counts[i.name] = (counts[i.name] ?? 0) + i.demos.length;
    }
    return counts;
  }, [deployed]);

  const totalDemoCount = useMemo(
    () => deployed.reduce((sum, i) => sum + i.demos.length, 0),
    [deployed],
  );

  const filteredDemos = useMemo(() => {
    let packages = deployed;

    // Feature filter: keep only packages that support the selected feature
    if (featureFilter) {
      packages = packages.filter((i) => i.features.includes(featureFilter));
    }

    // Framework filter: keep only packages matching selected framework
    if (framework !== "all") {
      packages = packages.filter((i) => i.name === framework);
    }

    // Generative UI filter: package-level then demo-level
    if (genUi !== "all") {
      packages = packages.filter(
        (i) => i.generative_ui && i.generative_ui.includes(genUi),
      );
    }

    // Interaction modality filter: package-level
    if (modality !== "all") {
      packages = packages.filter(
        (i) =>
          i.interaction_modalities &&
          i.interaction_modalities.includes(modality),
      );
    }

    // Collect demos with demo-level filtering
    const results: FilteredDemo[] = [];

    for (const integration of packages) {
      for (const demo of integration.demos) {
        // Generative UI demo-level: keep only demos in allowed list
        if (genUi !== "all") {
          const genUiConstraint = constraints.generative_ui[genUi];
          if (
            genUiConstraint?.allowed &&
            !genUiConstraint.allowed.includes(demo.id)
          ) {
            continue;
          }
        }

        // Interaction modality demo-level: exclude demos in excluded list
        if (modality !== "all") {
          const modalityConstraint =
            constraints.interaction_modalities[modality];
          if (
            modalityConstraint?.excluded &&
            modalityConstraint.excluded.includes(demo.id)
          ) {
            continue;
          }
        }

        results.push({ integration, demo });
      }
    }

    return results;
  }, [deployed, framework, genUi, modality, featureFilter]);

  const groupedDemos = useMemo(() => {
    const groups: Record<string, FilteredDemo[]> = {};
    for (const entry of filteredDemos) {
      const cat = entry.integration.category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(entry);
    }
    // Return ordered array of [category, demos] pairs
    const result = CATEGORY_ORDER.filter(
      (cat) => groups[cat] && groups[cat].length > 0,
    ).map((cat) => [cat, groups[cat]] as [string, FilteredDemo[]]);

    // Append any categories not in CATEGORY_ORDER so they aren't silently dropped
    const orderedCats = new Set(CATEGORY_ORDER);
    for (const cat of Object.keys(groups)) {
      if (!orderedCats.has(cat) && groups[cat].length > 0) {
        console.warn(
          `[integration-explorer] Unknown category "${cat}" — appending to end`,
        );
        result.push([cat, groups[cat]]);
      }
    }

    return result;
  }, [filteredDemos]);

  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  const hasActiveFilters =
    framework !== "all" ||
    genUi !== "all" ||
    modality !== "all" ||
    !!featureFilter;

  const clearFilter = (
    which: "framework" | "genUi" | "modality" | "feature",
  ) => {
    if (which === "framework") setFramework("all");
    else if (which === "genUi") setGenUi("all");
    else if (which === "feature") setFeatureFilter("");
    else setModality("all");
  };

  const activeFilterLabel =
    framework !== "all"
      ? framework
      : genUi !== "all"
        ? GEN_UI_LABELS[genUi]
        : modality !== "all"
          ? MODALITY_LABELS[modality]
          : "All Frameworks";

  return (
    <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
      {/* ---- Mobile filter dropdown ---- */}
      <div className="block sm:hidden relative">
        <button
          type="button"
          onClick={() => setMobileFilterOpen(!mobileFilterOpen)}
          className="w-full flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2.5 text-[13px] font-medium text-[var(--text-secondary)] hover:border-[var(--text-faint)] transition-colors"
        >
          <span>Filter: {activeFilterLabel}</span>
          <svg
            className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${mobileFilterOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
        {mobileFilterOpen && (
          <div className="absolute left-0 right-0 top-full mt-1 z-40 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-lg p-4 max-h-[60vh] overflow-y-auto">
            <FilterGroup title="Framework">
              <RadioOption
                label="All"
                count={totalDemoCount}
                selected={framework === "all"}
                onClick={() => {
                  setFramework("all");
                  setMobileFilterOpen(false);
                }}
              />
              {frameworkOptions.map((name) => (
                <RadioOption
                  key={name}
                  label={name}
                  count={frameworkCounts[name] ?? 0}
                  selected={framework === name}
                  onClick={() => {
                    setFramework(name);
                    setMobileFilterOpen(false);
                  }}
                />
              ))}
              {[...comingSoonFrameworks].map((name) => (
                <RadioOption key={name} label={name} comingSoon />
              ))}
            </FilterGroup>

            <FilterGroup title="Generative UI">
              <RadioOption
                label="All"
                selected={genUi === "all"}
                onClick={() => {
                  setGenUi("all");
                  setMobileFilterOpen(false);
                }}
              />
              {GEN_UI_VALUES.map((v) => (
                <RadioOption
                  key={v}
                  label={GEN_UI_LABELS[v]}
                  selected={genUi === v}
                  comingSoon={comingSoonGenUi.has(v)}
                  onClick={
                    comingSoonGenUi.has(v)
                      ? undefined
                      : () => {
                          setGenUi(v);
                          setMobileFilterOpen(false);
                        }
                  }
                />
              ))}
            </FilterGroup>

            <FilterGroup title="Interaction">
              <RadioOption
                label="All"
                selected={modality === "all"}
                onClick={() => {
                  setModality("all");
                  setMobileFilterOpen(false);
                }}
              />
              {MODALITY_VALUES.map((v) => (
                <RadioOption
                  key={v}
                  label={MODALITY_LABELS[v]}
                  selected={modality === v}
                  comingSoon={comingSoonModality.has(v)}
                  onClick={
                    comingSoonModality.has(v)
                      ? undefined
                      : () => {
                          setModality(v);
                          setMobileFilterOpen(false);
                        }
                  }
                />
              ))}
            </FilterGroup>
          </div>
        )}
      </div>

      {/* ---- Desktop sidebar ---- */}
      <aside
        className="hidden sm:block shrink-0 sticky top-4 self-start"
        style={{ width: 220 }}
      >
        {/* Framework group */}
        <FilterGroup title="Framework">
          <RadioOption
            label="All"
            count={totalDemoCount}
            selected={framework === "all"}
            onClick={() => setFramework("all")}
          />
          {frameworkOptions.map((name) => (
            <RadioOption
              key={name}
              label={name}
              count={frameworkCounts[name] ?? 0}
              selected={framework === name}
              onClick={() => setFramework(name)}
            />
          ))}
          {[...comingSoonFrameworks].map((name) => (
            <RadioOption key={name} label={name} comingSoon />
          ))}
        </FilterGroup>

        {/* Generative UI group */}
        <FilterGroup title="Generative UI">
          <RadioOption
            label="All"
            selected={genUi === "all"}
            onClick={() => setGenUi("all")}
          />
          {GEN_UI_VALUES.map((v) => (
            <RadioOption
              key={v}
              label={GEN_UI_LABELS[v]}
              selected={genUi === v}
              comingSoon={comingSoonGenUi.has(v)}
              onClick={comingSoonGenUi.has(v) ? undefined : () => setGenUi(v)}
            />
          ))}
        </FilterGroup>

        {/* Interaction group */}
        <FilterGroup title="Interaction">
          <RadioOption
            label="All"
            selected={modality === "all"}
            onClick={() => setModality("all")}
          />
          {MODALITY_VALUES.map((v) => (
            <RadioOption
              key={v}
              label={MODALITY_LABELS[v]}
              selected={modality === v}
              comingSoon={comingSoonModality.has(v)}
              onClick={
                comingSoonModality.has(v) ? undefined : () => setModality(v)
              }
            />
          ))}
        </FilterGroup>
      </aside>

      {/* ---- Main area ---- */}
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-baseline gap-3 mb-4">
          <h2 className="text-[18px] font-semibold text-[var(--text)]">
            Demos
          </h2>
          <span className="text-[13px] text-[var(--text-muted)]">
            {filteredDemos.length}{" "}
            {filteredDemos.length === 1 ? "result" : "results"}
          </span>
        </div>

        {/* Active filter chips */}
        {hasActiveFilters && (
          <div className="flex flex-wrap gap-2 mb-4">
            {featureFilter && (
              <FilterChip
                label={`Feature: ${featureFilter}`}
                onDismiss={() => clearFilter("feature")}
              />
            )}
            {framework !== "all" && (
              <FilterChip
                label={framework}
                onDismiss={() => clearFilter("framework")}
              />
            )}
            {genUi !== "all" && (
              <FilterChip
                label={GEN_UI_LABELS[genUi]}
                onDismiss={() => clearFilter("genUi")}
              />
            )}
            {modality !== "all" && (
              <FilterChip
                label={MODALITY_LABELS[modality]}
                onDismiss={() => clearFilter("modality")}
              />
            )}
          </div>
        )}

        {/* Demo cards grouped by category */}
        {filteredDemos.length === 0 ? (
          <div className="text-center py-16 text-[var(--text-muted)] text-sm">
            No demos match the current filters.
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {groupedDemos.map(([category, demos]) => (
              <section key={category}>
                <h3 className="text-[13px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                  {getCategoryLabel(category)}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {demos.map(({ integration, demo }) => (
                    <DemoCard
                      key={`${integration.slug}::${demo.id}`}
                      integration={integration}
                      demo={demo}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterGroup
// ---------------------------------------------------------------------------

function FilterGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2 px-1">
        {title}
      </h3>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RadioOption
// ---------------------------------------------------------------------------

function RadioOption({
  label,
  count,
  selected,
  comingSoon,
  onClick,
}: {
  label: string;
  count?: number;
  selected?: boolean;
  comingSoon?: boolean;
  onClick?: () => void;
}) {
  if (comingSoon) {
    return (
      <div className="flex items-center justify-between rounded-md px-2 py-1.5 cursor-default">
        <span className="text-[13px] text-[var(--text-faint)]">{label}</span>
        <span className="text-[10px] text-[var(--text-faint)] italic">
          soon
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors ${
        selected
          ? "bg-[var(--accent-light)] text-[var(--accent)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
      }`}
    >
      <span className={`text-[13px] ${selected ? "font-medium" : ""}`}>
        {label}
      </span>
      {count !== undefined && (
        <span
          className={`text-[11px] ${selected ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// FilterChip
// ---------------------------------------------------------------------------

function FilterChip({
  label,
  onDismiss,
}: {
  label: string;
  onDismiss: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[12px] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
    >
      {label}
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5" />
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------
// DemoCard
// ---------------------------------------------------------------------------

function DemoCard({
  integration,
  demo,
}: {
  integration: Integration;
  demo: Integration["demos"][number];
}) {
  const [hovered, setHovered] = useState(false);
  const previewUrl =
    demo.animated_preview_url || integration.animated_preview_url;

  return (
    <Link
      href={`/integrations/${integration.slug}?demo=${demo.id}`}
      className="group relative block rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 transition-all hover:border-[var(--accent)] hover:shadow-md"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Animated preview — floating overlay on hover, no layout shift */}
      {hovered && previewUrl && (
        <div className="absolute bottom-full left-0 right-0 z-50 mb-2 pointer-events-none">
          <video
            src={previewUrl}
            autoPlay
            muted
            loop
            playsInline
            className="w-full h-auto rounded-lg shadow-xl border border-[var(--border)]"
          />
        </div>
      )}

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {integration.logo && (
          <img
            src={integration.logo}
            alt=""
            className="w-5 h-5 rounded"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        <span className="inline-flex items-center rounded-full bg-[var(--accent-light)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent)]">
          {integration.name}
        </span>
        {integration.managed_platform && (
          <span
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium text-[var(--blue)] cursor-pointer"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--blue) 10%, transparent)",
            }}
            onClick={(e) => {
              e.preventDefault();
              window.open(integration.managed_platform!.url, "_blank");
            }}
          >
            {integration.managed_platform.name}
          </span>
        )}
      </div>

      {/* Name + description */}
      <h3 className="text-[14px] font-semibold text-[var(--text)] mb-1 group-hover:text-[var(--accent)] transition-colors">
        {demo.name}
      </h3>
      <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed line-clamp-2">
        {demo.description}
      </p>
    </Link>
  );
}

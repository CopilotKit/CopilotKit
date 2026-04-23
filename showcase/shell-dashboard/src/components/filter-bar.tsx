"use client";

import { useMemo } from "react";
import type { FilterActions, FilterState } from "@/hooks/useFilterState";
import type { FeatureCategory, Integration } from "@/lib/registry";

const LANGUAGE_LABELS: Record<string, string> = {
  python: "Python",
  typescript: "TypeScript",
  dotnet: ".NET",
  java: "Java",
};

const INTEGRATION_CATEGORY_LABELS: Record<string, string> = {
  popular: "Most Popular",
  "agent-framework": "Agent Frameworks",
  "enterprise-platform": "Enterprise",
  "provider-sdk": "Provider SDKs",
  protocol: "Protocols",
  emerging: "Emerging",
  starter: "Starter",
};

interface FilterBarProps {
  integrations: Integration[];
  featureCategories: FeatureCategory[];
  state: FilterState;
  actions: FilterActions;
  /** Counts after current filters for the result summary. */
  summary: { visibleFeatures: number; totalFeatures: number; visibleIntegrations: number; totalIntegrations: number };
}

export function FilterBar({
  integrations,
  featureCategories,
  state,
  actions,
  summary,
}: FilterBarProps) {
  // Unique language + integration-category axes derived from the actual data
  // (not hard-coded) — so adding a new language to the registry surfaces a
  // pill automatically without a code change.
  const { languages, integrationCategories } = useMemo(() => {
    const langs = new Set<string>();
    const cats = new Set<string>();
    for (const i of integrations) {
      if (i.language) langs.add(i.language);
      if (i.category) cats.add(i.category);
    }
    return {
      languages: [...langs].sort(),
      integrationCategories: [...cats].sort(),
    };
  }, [integrations]);

  const hasAnyFilter =
    state.q.length > 0 ||
    state.languages.length > 0 ||
    state.integrationCategories.length > 0 ||
    state.featureCategories.length > 0 ||
    state.onlyGreen;

  return (
    <div className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)] px-8 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <input
            type="search"
            placeholder="Search features or integrations…"
            value={state.q}
            onChange={(e) => actions.setSearch(e.target.value)}
            className="h-7 w-64 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 text-[12px] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>

        <PillGroup
          label="Language"
          options={languages}
          selected={state.languages}
          onToggle={actions.toggleLanguage}
          labelFor={(v) => LANGUAGE_LABELS[v] ?? v}
        />

        <PillGroup
          label="Integration"
          options={integrationCategories}
          selected={state.integrationCategories}
          onToggle={actions.toggleIntegrationCategory}
          labelFor={(v) => INTEGRATION_CATEGORY_LABELS[v] ?? v}
        />

        <PillGroup
          label="Feature"
          options={featureCategories.map((c) => c.id)}
          selected={state.featureCategories}
          onToggle={actions.toggleFeatureCategory}
          labelFor={(v) =>
            featureCategories.find((c) => c.id === v)?.name ?? v
          }
        />

        <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] select-none cursor-pointer">
          <input
            type="checkbox"
            checked={state.onlyGreen}
            onChange={(e) => actions.setOnlyGreen(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--ok)] cursor-pointer"
          />
          Only fully green
        </label>

        <div className="ml-auto flex items-center gap-3 text-[11px] text-[var(--text-muted)] tabular-nums">
          <span>
            {summary.visibleFeatures}/{summary.totalFeatures} features · {summary.visibleIntegrations}/{summary.totalIntegrations} integrations
          </span>
          {hasAnyFilter && (
            <button
              type="button"
              onClick={actions.clearAll}
              className="rounded border border-[var(--border)] px-2 py-0.5 text-[var(--text-secondary)] hover:text-[var(--text)] hover:border-[var(--text-muted)]"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PillGroup({
  label,
  options,
  selected,
  onToggle,
  labelFor,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  labelFor: (value: string) => string;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const on = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              className={
                on
                  ? "rounded-full border px-2 py-0.5 text-[10.5px] border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)]"
                  : "rounded-full border px-2 py-0.5 text-[10.5px] border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text)] hover:border-[var(--text-muted)]"
              }
              aria-pressed={on}
            >
              {labelFor(opt)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

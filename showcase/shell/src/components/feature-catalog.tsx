"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  type Feature,
  type FeatureCategory,
  type Integration,
} from "@/lib/registry";

interface FeatureCatalogProps {
  features: Feature[];
  categories: FeatureCategory[];
  integrations: Integration[];
}

interface FeatureWithIntegrations {
  feature: Feature;
  integrations: Integration[];
}

export function FeatureCatalog({
  features,
  categories,
  integrations,
}: FeatureCatalogProps) {
  const deployed = useMemo(
    () => integrations.filter((i) => i.deployed),
    [integrations],
  );

  // Group features by category, attaching which deployed integrations support each
  const groupedFeatures = useMemo(() => {
    const groups: {
      category: FeatureCategory;
      items: FeatureWithIntegrations[];
    }[] = [];

    for (const category of categories) {
      const categoryFeatures = features.filter(
        (f) => f.category === category.id,
      );
      const items: FeatureWithIntegrations[] = [];

      for (const feature of categoryFeatures) {
        const supporting = deployed.filter((i) =>
          i.features.includes(feature.id),
        );
        items.push({ feature, integrations: supporting });
      }

      // Only show categories that have at least one feature with at least one integration
      if (items.some((item) => item.integrations.length > 0)) {
        groups.push({ category, items });
      }
    }

    return groups;
  }, [features, categories, deployed]);

  if (groupedFeatures.length === 0) {
    return (
      <div className="text-center py-16 text-[var(--text-muted)] text-sm">
        No features with live integrations yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10 max-w-5xl mx-auto">
      {groupedFeatures.map(({ category, items }) => (
        <section key={category.id}>
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-4">
            {category.name}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map(({ feature, integrations: supporting }) => (
              <FeatureCard
                key={feature.id}
                feature={feature}
                integrations={supporting}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function FeatureCard({
  feature,
  integrations,
}: {
  feature: Feature;
  integrations: Integration[];
}) {
  const hasIntegrations = integrations.length > 0;

  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        hasIntegrations
          ? "border-[var(--border)] bg-[var(--bg-surface)]"
          : "border-transparent bg-[var(--bg-elevated)] opacity-50"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="text-sm font-semibold text-[var(--text)]">
          {feature.name}
        </h4>
        {hasIntegrations && (
          <Link
            href={`/integrations?feature=${feature.id}`}
            className="shrink-0 text-[10px] font-medium text-[var(--accent)] hover:underline"
          >
            View all
          </Link>
        )}
      </div>
      <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed mb-3">
        {feature.description}
      </p>
      {hasIntegrations ? (
        <div className="flex flex-wrap gap-1.5">
          {integrations.map((i) => (
            <Link
              key={i.slug}
              href={`/integrations/${i.slug}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--accent-light)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white transition-colors"
            >
              {i.logo && (
                <img
                  src={i.logo}
                  alt=""
                  className="w-3 h-3 rounded-sm"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              )}
              {i.name}
            </Link>
          ))}
        </div>
      ) : (
        <span className="text-[10px] text-[var(--text-faint)] italic">
          Coming soon
        </span>
      )}
    </div>
  );
}

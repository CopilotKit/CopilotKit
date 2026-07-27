import frontendCatalogData from "@/data/frontend-catalog.json";
import registryData from "@/data/registry.json";
import type {
  FrameworkOverviewData,
  SupportedFeature,
} from "@/data/frameworks/types";

const SHOWCASE_ORIGIN = "https://showcase.copilotkit.ai";

interface FrontendCatalogCell {
  frontend: string;
  integration: string;
  feature: string;
  runnable: boolean;
}

interface RegistryFeature {
  id: string;
  name: string;
}

interface RunnableDemo {
  cell: FrontendCatalogCell;
  feature: RegistryFeature;
}

const catalogCells = (frontendCatalogData as { cells: FrontendCatalogCell[] })
  .cells;
const registryFeatures = (
  registryData as {
    feature_registry: { features: RegistryFeature[] };
  }
).feature_registry.features;

const registryFeatureById = new Map(
  registryFeatures.map((feature) => [feature.id, feature]),
);

function showcaseHref(cell: FrontendCatalogCell): string {
  return `${SHOWCASE_ORIGIN}/${cell.frontend}/${cell.integration}/${cell.feature}`;
}

function matchTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(
      (token) =>
        token.length > 1 && !["and", "in", "the", "with"].includes(token),
    );
}

function matchScore(feature: SupportedFeature, demo: RunnableDemo): number {
  const wanted = matchTokens(feature.title);
  if (wanted.length === 0) return 0;
  const available = new Set(matchTokens(demo.feature.name));
  return wanted.filter((token) => available.has(token)).length / wanted.length;
}

function findDemoForFeature(
  feature: SupportedFeature,
  demos: RunnableDemo[],
): RunnableDemo | null {
  let best: RunnableDemo | null = null;
  let bestScore = 0;

  for (const demo of demos) {
    const score = matchScore(feature, demo);
    if (score > bestScore) {
      best = demo;
      bestScore = score;
    }
  }

  return bestScore >= 0.5 ? best : null;
}

/**
 * Adapt a generated backend overview to the Angular docs surface.
 *
 * The overview's structure, media, architecture, and CTA remain owned by the
 * generated framework record. Only frontend-sensitive copy and links change.
 * Demo URLs are accepted exclusively from exact runnable
 * `(angular, integration, feature)` catalog cells, so selecting a backend can
 * never silently fall through to another integration's demo.
 */
export function buildAngularBackendOverview(
  overview: FrameworkOverviewData,
  integration: string,
): FrameworkOverviewData {
  const demos = catalogCells.flatMap((cell): RunnableDemo[] => {
    if (
      cell.frontend !== "angular" ||
      cell.integration !== integration ||
      !cell.runnable
    ) {
      return [];
    }

    const feature = registryFeatureById.get(cell.feature);
    return feature ? [{ cell, feature }] : [];
  });
  const matchedDemos: Array<{
    demo: RunnableDemo;
    overviewFeature: SupportedFeature;
  }> = [];

  const overviewSourceSlug = overview.guideLink.split("/")[1] ?? integration;
  const supportedFeatures = overview.supportedFeatures.map((feature) => {
    const demo = findDemoForFeature(feature, demos);
    const overviewFeature = {
      ...feature,
      description: feature.description.replace(
        /\bReact components?\b/g,
        (match) =>
          match.endsWith("s") ? "Angular components" : "an Angular component",
      ),
      documentationLink: feature.documentationLink.startsWith(
        `/${overviewSourceSlug}/`,
      )
        ? `/${integration}${feature.documentationLink.slice(
            overviewSourceSlug.length + 1,
          )}`
        : feature.documentationLink,
      demoLink: demo ? showcaseHref(demo.cell) : undefined,
    };

    if (demo && !matchedDemos.some(({ demo: seen }) => seen === demo)) {
      matchedDemos.push({ demo, overviewFeature });
    }

    return overviewFeature;
  });

  return {
    ...overview,
    guideLink: `/${integration}/quickstart`,
    supportedFeatures,
    liveDemos: matchedDemos.map(({ demo, overviewFeature }) => ({
      type: demo.cell.feature,
      title: overviewFeature.title,
      description: overviewFeature.description,
      iframeUrl: showcaseHref(demo.cell),
    })),
  };
}

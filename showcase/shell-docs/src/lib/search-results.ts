import type { FrontendId } from "@/lib/frontend-options";
import { compareByDisplayOrder } from "@/lib/framework-order";
import type { Registry } from "@/lib/registry";
import {
  frameworkDocsHref,
  normalizeHref,
  parseDocsHref,
  parseIntegrationDocsHref,
} from "@/lib/search-hrefs";

export type SearchResultType =
  | "integration"
  | "feature"
  | "page"
  | "reference"
  | "ag-ui"
  | "docs";

export type SearchResultGroupLabel =
  | "Documentation"
  | "API Reference"
  | "AG-UI"
  | "Integrations";

export interface SearchIndexEntry {
  type: "page" | "reference" | "ag-ui";
  title: string;
  subtitle: string;
  section?: string;
  href: string;
}

export interface SearchResult {
  id: string;
  type: SearchResultType;
  group: SearchResultGroupLabel;
  title: string;
  subtitle: string;
  section?: string;
  href: string;
  frameworkName?: string;
  frameworkCount?: number;
  selectedFramework?: boolean;
}

interface FrameworkOption {
  slug: string;
  name: string;
  logo?: string | null;
}

type ActiveFrontend = Exclude<FrontendId, "react">;

interface BuildSearchResultsOptions {
  query: string;
  pages: SearchIndexEntry[];
  registryData: Registry | null;
  selectedFramework: string;
  shellHost: string;
  activeFrontend?: ActiveFrontend | null;
  limit?: number;
}

const GROUP_ORDER: SearchResultGroupLabel[] = [
  "Documentation",
  "API Reference",
  "AG-UI",
  "Integrations",
];

const DOCS_FOLDER_OVERRIDES: Record<string, string> = {
  "langgraph-python": "langgraph",
  "langgraph-typescript": "langgraph",
  "langgraph-fastapi": "langgraph",
  "google-adk": "adk",
  "crewai-crews": "crewai-flows",
  strands: "aws-strands",
  "strands-typescript": "aws-strands",
  "ms-agent-dotnet": "microsoft-agent-framework",
  "ms-agent-python": "microsoft-agent-framework",
  "ms-agent-harness-dotnet": "microsoft-agent-framework",
};

function getDocsFolderForSlug(slug: string): string {
  return DOCS_FOLDER_OVERRIDES[slug] ?? slug;
}

function buildDocsFolderMap(
  registryData: Registry | null,
): Map<string, FrameworkOption[]> {
  const map = new Map<string, FrameworkOption[]>();
  for (const integration of registryData?.integrations ?? []) {
    if (integration.docs_mode === "hidden") continue;
    const folder = getDocsFolderForSlug(integration.slug);
    const next = map.get(folder) ?? [];
    next.push({
      slug: integration.slug,
      name: integration.name,
      logo: integration.logo,
    });
    map.set(folder, next);
  }

  for (const options of map.values()) {
    options.sort((a, b) => compareByDisplayOrder(a.slug, b.slug));
  }

  return map;
}

function matchesQuery(
  fields: Array<string | undefined>,
  query: string,
): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = fields.filter(Boolean).join(" ").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function groupForResult(
  type: SearchResultType,
  href: string,
): SearchResultGroupLabel {
  if (type === "reference" || href.startsWith("/reference")) {
    return "API Reference";
  }
  if (type === "ag-ui" || href.startsWith("/ag-ui")) return "AG-UI";
  if (
    type === "integration" ||
    type === "feature" ||
    href.includes("/integrations")
  ) {
    return "Integrations";
  }
  return "Documentation";
}

function scoreResult(result: SearchResult, query: string): number {
  const normalizedQuery = query.toLowerCase();
  const title = result.title.toLowerCase();
  const typePriority: Record<SearchResultType, number> = {
    docs: 0,
    page: 1,
    integration: 2,
    reference: 3,
    "ag-ui": 4,
    feature: 6,
  };

  let score = typePriority[result.type] * 10;
  if (result.selectedFramework) score -= 6;
  if (title === normalizedQuery) score -= 30;
  else if (title.startsWith(normalizedQuery)) score -= 18;
  else if (title.includes(normalizedQuery)) score -= 8;
  return score;
}

function compareResults(
  left: SearchResult,
  right: SearchResult,
  query: string,
): number {
  const scoreDifference = scoreResult(left, query) - scoreResult(right, query);
  if (scoreDifference !== 0) return scoreDifference;

  const groupDifference =
    GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group);
  if (groupDifference !== 0) return groupDifference;

  const titleDifference = left.title.localeCompare(right.title);
  if (titleDifference !== 0) return titleDifference;
  const hrefDifference = left.href.localeCompare(right.href);
  if (hrefDifference !== 0) return hrefDifference;
  return left.id.localeCompare(right.id);
}

function dedupeResults(items: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  });
}

export function buildSearchResults({
  query,
  pages,
  registryData,
  selectedFramework,
  shellHost,
  activeFrontend = null,
  limit = 12,
}: BuildSearchResultsOptions): SearchResult[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  const items: SearchResult[] = [];
  const docsFolderMap = buildDocsFolderMap(registryData);
  const frameworkOptions = registryData?.integrations ?? [];
  const selectedFrameworkName =
    frameworkOptions.find((option) => option.slug === selectedFramework)
      ?.name ?? selectedFramework;
  const docsGroups = new Map<
    string,
    {
      topic: string;
      entry: SearchIndexEntry;
      href: string;
      frameworkCount?: number;
    }
  >();

  for (const page of pages) {
    const integrationDoc = parseIntegrationDocsHref(page.href);
    if (integrationDoc) {
      const options = docsFolderMap.get(integrationDoc.folder) ?? [];
      const registryOption = options.find(
        (option) => option.slug === selectedFramework,
      );
      const selectedOption =
        registryOption ??
        (getDocsFolderForSlug(selectedFramework) === integrationDoc.folder
          ? { slug: selectedFramework, name: selectedFramework }
          : undefined);
      if (!selectedOption) continue;
      if (
        !matchesQuery(
          [
            page.title,
            page.subtitle,
            page.section,
            selectedOption.name,
            selectedOption.slug,
            integrationDoc.topic,
          ],
          normalizedQuery,
        )
      ) {
        continue;
      }
      docsGroups.set(integrationDoc.topic || "overview", {
        topic: integrationDoc.topic,
        entry: page,
        href: frameworkDocsHref(
          selectedOption.slug,
          integrationDoc.topic,
          activeFrontend,
        ),
        frameworkCount: options.length > 0 ? options.length : undefined,
      });
      continue;
    }

    const docsTopic = parseDocsHref(page.href);
    if (docsTopic !== null) {
      if (
        !matchesQuery(
          [page.title, page.subtitle, page.section, docsTopic],
          normalizedQuery,
        )
      ) {
        continue;
      }
      if (!docsGroups.has(docsTopic)) {
        docsGroups.set(docsTopic, {
          topic: docsTopic,
          entry: page,
          href: frameworkDocsHref(selectedFramework, docsTopic, activeFrontend),
        });
      }
      continue;
    }

    if (
      matchesQuery([page.title, page.subtitle, page.section], normalizedQuery)
    ) {
      const href = normalizeHref(page.href, shellHost);
      items.push({
        id: page.href,
        type: page.type,
        group: groupForResult(page.type, href),
        title: page.title,
        subtitle: page.subtitle,
        section: page.section,
        href,
      });
    }
  }

  for (const docsGroup of docsGroups.values()) {
    items.push({
      id: `docs:${docsGroup.topic}`,
      type: "docs",
      group: "Documentation",
      title: docsGroup.entry.title,
      subtitle: docsGroup.entry.subtitle,
      section: docsGroup.entry.section || "Framework docs",
      href: docsGroup.href,
      frameworkName: docsGroup.frameworkCount
        ? selectedFrameworkName
        : undefined,
      frameworkCount: docsGroup.frameworkCount,
      selectedFramework: true,
    });
  }

  for (const integration of registryData?.integrations ?? []) {
    if (
      integration.docs_mode !== "hidden" &&
      matchesQuery(
        [integration.name, integration.description, integration.slug],
        normalizedQuery,
      )
    ) {
      items.push({
        id: `integration:${integration.slug}`,
        type: "integration",
        group: "Integrations",
        title: integration.name,
        subtitle: integration.description.slice(0, 80),
        href: `${shellHost}/integrations/${integration.slug}`,
        selectedFramework: integration.slug === selectedFramework,
      });
    }
  }

  for (const feature of registryData?.feature_registry.features ?? []) {
    if (
      matchesQuery(
        [feature.name, feature.description, feature.category],
        normalizedQuery,
      )
    ) {
      items.push({
        id: `feature:${feature.id}`,
        type: "feature",
        group: "Integrations",
        title: feature.name,
        subtitle: feature.description,
        href: "/",
      });
    }
  }

  return dedupeResults(
    items.toSorted((left, right) =>
      compareResults(left, right, normalizedQuery),
    ),
  ).slice(0, limit);
}

export function groupSearchResults(results: SearchResult[]) {
  return GROUP_ORDER.flatMap((label) => {
    const items = results.filter((result) => result.group === label);
    return items.length > 0 ? [{ label, items }] : [];
  });
}

export function buildQuickSearchResults(
  pages: SearchIndexEntry[],
  shellHost: string,
): SearchResult[] {
  const destinations = ["/", "/reference", "/ag-ui", "/integrations"];
  return destinations.flatMap((destination) => {
    const page = pages.find((entry) => entry.href === destination);
    if (!page) return [];
    const href = normalizeHref(page.href, shellHost);
    return [
      {
        id: `quick:${destination}`,
        type: page.type,
        group: groupForResult(page.type, href),
        title: page.title,
        subtitle: page.subtitle,
        section: page.section,
        href,
      },
    ];
  });
}

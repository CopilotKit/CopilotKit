import {
  frontendPathForBackend,
  isChannelFrontend,
} from "@/lib/frontend-options";
import type { FrontendId } from "@/lib/frontend-options";
import { compareByDisplayOrder } from "@/lib/framework-order";
import {
  CHANNEL_FRONTENDS,
  channelGuideHref,
  getChannelGuidePublicSlug,
  getChannelGuideSourceSlug,
} from "@/lib/channel-guide-routes";
import type { ChannelFrontend } from "@/lib/channel-guide-routes";

const ROOT_FRAMEWORK = "built-in-agent";
const CHANNEL_DOCS_HREF = "/docs/channels";
const FRONTEND_IDS = new Set([
  "vue",
  "react-native",
  "angular",
  "slack",
  "teams",
]);
type FrontendPageId = Exclude<FrontendId, "react">;

export interface ChannelSearchHref {
  frontend: ChannelFrontend;
  href: string;
}

export interface ResolveChannelSearchResultsInput {
  topic: string;
  title: string;
  selectedFramework: string;
  activeFrontend: FrontendPageId | null;
}

export interface ChannelSearchResult {
  frontend: ChannelFrontend;
  groupKey: string;
  id: string;
  title: string;
  href: string;
}

export interface FrameworkSearchRegistryEntry {
  slug: string;
  name: string;
  logo?: string | null;
  docs_mode?: "generated" | "authored" | "hidden";
}

export interface FrameworkSearchOption {
  slug: string;
  name: string;
  logo: string | null;
}

const SERVER_ONLY_FRAMEWORK_NAMES: Readonly<Record<string, string>> = {
  deepagents: "Deep Agents",
};

function fallbackFrameworkName(slug: string): string {
  return (
    SERVER_ONLY_FRAMEWORK_NAMES[slug] ??
    slug
      .split("-")
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(" ")
  );
}

export function buildFrameworkSearchOptions(
  integrations: readonly FrameworkSearchRegistryEntry[],
  serverKnownFrameworks: readonly string[],
): FrameworkSearchOption[] {
  const registrySlugs = new Set(
    integrations.map((integration) => integration.slug),
  );
  const options: FrameworkSearchOption[] = integrations
    .filter((integration) => integration.docs_mode !== "hidden")
    .map((integration) => ({
      slug: integration.slug,
      name: integration.name,
      logo: integration.logo ?? null,
    }));
  const optionSlugs = new Set(options.map((option) => option.slug));

  for (const slug of serverKnownFrameworks) {
    // Hidden integrations are still present in the raw client registry, so
    // only merge server-validated docs-only frameworks missing from it.
    if (registrySlugs.has(slug) || optionSlugs.has(slug)) continue;
    options.push({
      slug,
      name: fallbackFrameworkName(slug),
      logo: null,
    });
    optionSlugs.add(slug);
  }

  return options.sort((a, b) => compareByDisplayOrder(a.slug, b.slug));
}

export function reconcileFrameworkSearchSelection(
  selectedFramework: string,
  options: readonly FrameworkSearchOption[],
): string {
  if (
    options.length === 0 ||
    options.some((option) => option.slug === selectedFramework)
  ) {
    return selectedFramework;
  }

  return (
    options.find((option) => option.slug === ROOT_FRAMEWORK)?.slug ??
    options[0].slug
  );
}

export function isChannelDocsHref(href: string): boolean {
  return (
    href === CHANNEL_DOCS_HREF ||
    href.startsWith(`${CHANNEL_DOCS_HREF}/`) ||
    href.startsWith(`${CHANNEL_DOCS_HREF}?`) ||
    href.startsWith(`${CHANNEL_DOCS_HREF}#`)
  );
}

export function parseChannelDocsHref(href: string): { topic: string } | null {
  if (href === CHANNEL_DOCS_HREF) {
    const topic = getChannelGuidePublicSlug("channels");
    return topic ? { topic } : null;
  }
  if (!href.startsWith(`${CHANNEL_DOCS_HREF}/`)) return null;

  const sourceSlug = href.slice("/docs/".length);
  const topic = getChannelGuidePublicSlug(sourceSlug);
  if (!topic || `/docs/${getChannelGuideSourceSlug(topic)}` !== href) {
    return null;
  }

  return { topic };
}

export function resolveChannelSearchHrefs(
  topic: string,
  selectedFramework: string,
  activeFrontend: FrontendPageId | null,
): ChannelSearchHref[] {
  if (!getChannelGuideSourceSlug(topic)) return [];

  const frontends: readonly ChannelFrontend[] =
    activeFrontend && isChannelFrontend(activeFrontend)
      ? [activeFrontend]
      : CHANNEL_FRONTENDS;

  return frontends.map((frontend) => ({
    frontend,
    href: channelGuideHref(frontend, selectedFramework, topic),
  }));
}

export function resolveChannelSearchResults({
  topic,
  title,
  selectedFramework,
  activeFrontend,
}: ResolveChannelSearchResultsInput): ChannelSearchResult[] {
  const destinations = resolveChannelSearchHrefs(
    topic,
    selectedFramework,
    activeFrontend,
  );
  const labelProviders = destinations.length > 1;

  return destinations.map(({ frontend, href }) => {
    const providerLabel = frontend === "slack" ? "Slack" : "Microsoft Teams";
    return {
      frontend,
      groupKey: `channel:${frontend}:${topic}`,
      id: `docs:channel:${frontend}:${topic}`,
      title: labelProviders ? `${title} — ${providerLabel}` : title,
      href,
    };
  });
}

export function parseIntegrationDocsHref(
  href: string,
): { folder: string; topic: string } | null {
  const prefix = "/docs/integrations/";
  if (!href.startsWith(prefix)) return null;
  const rest = href.slice(prefix.length);
  const [folder, ...topicParts] = rest.split("/").filter(Boolean);
  if (!folder) return null;
  return { folder, topic: topicParts.join("/") };
}

export function parseDocsHref(href: string): string | null {
  if (!href.startsWith("/docs/")) return null;
  if (href.startsWith("/docs/integrations/")) return null;
  if (href.startsWith("/docs/frontends/")) return null;
  if (isChannelDocsHref(href)) return null;
  return href.slice("/docs/".length);
}

export function frameworkDocsHref(
  framework: string,
  topic: string,
  frontend?: FrontendPageId | null,
): string {
  if (frontend) {
    return frontendPathForBackend(
      frontend,
      topic,
      framework === ROOT_FRAMEWORK ? null : framework,
    );
  }

  if (framework === ROOT_FRAMEWORK) {
    return topic ? `/${topic}` : "/";
  }
  return topic ? `/${framework}/${topic}` : `/${framework}`;
}

export function normalizeHref(href: string, shellHost: string): string {
  if (href === "/integrations" || href === "/matrix") {
    return `${shellHost}${href}`;
  }

  const frontendDocsPrefix = "/docs/frontends/";
  if (href.startsWith(frontendDocsPrefix)) {
    const [frontend, ...tail] = href
      .slice(frontendDocsPrefix.length)
      .split("/")
      .filter(Boolean);

    // Regenerated indexes expand shared frontend guidance once per frontend.
    // This only protects users with a stale index from landing on 404.
    if (frontend === "using-these-docs" || frontend === "docs-status") {
      return "/vue/using-these-docs";
    }
    if (FRONTEND_IDS.has(frontend)) {
      return tail.length > 0
        ? `/${frontend}/${tail.join("/")}`
        : `/${frontend}`;
    }
  }

  const rootDocsPrefix = `/docs/${ROOT_FRAMEWORK}`;
  if (href === rootDocsPrefix) return "/";
  if (href.startsWith(`${rootDocsPrefix}/`)) {
    return href.slice(rootDocsPrefix.length) || "/";
  }

  const rootIntegrationDocsPrefix = `/docs/integrations/${ROOT_FRAMEWORK}`;
  if (href === rootIntegrationDocsPrefix) return "/";
  if (href.startsWith(`${rootIntegrationDocsPrefix}/`)) {
    return href.slice(rootIntegrationDocsPrefix.length) || "/";
  }

  if (href.startsWith("/docs/")) {
    return href.slice("/docs".length) || "/";
  }
  return href;
}

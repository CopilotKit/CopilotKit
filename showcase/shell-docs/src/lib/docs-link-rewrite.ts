import { getIntegrations, ROOT_FRAMEWORK } from "@/lib/registry";
import { RESERVED_ROUTE_SLUGS } from "@/lib/reserved-route-slugs";
import { matchesSeoRedirectSource } from "@/lib/seo-redirects";

const CROSS_FRAMEWORK_SLUGS: ReadonlySet<string> = new Set<string>([
  ...getIntegrations().map((i) => i.slug),
  "a2a",
  "agent-spec",
  "deepagents",
]);

const RESERVED_ROUTE_SLUG_SET: ReadonlySet<string> = new Set<string>(
  RESERVED_ROUTE_SLUGS as readonly string[],
);

export interface ResolveDocsHrefOptions {
  slugHrefPrefix: string;
  frameworkOverride?: string | null;
  /**
   * Optional documentation namespace used only for authored links.
   *
   * This is intentionally separate from `frameworkOverride`, which selects
   * the real showcase/backend integration used by snippets, demos, tabs, and
   * feature-gated content. Vue's projected surface needs Vue-scoped links
   * while continuing to resolve examples against a real backend integration.
   */
  linkNamespaceFramework?: string | null;
}

function stripPathPrefix(href: string, prefix: string): string | null {
  if (href === prefix) return "/";
  if (!href.startsWith(prefix)) return null;

  const suffix = href.slice(prefix.length);
  if (suffix.startsWith("/")) return suffix;
  if (suffix.startsWith("?") || suffix.startsWith("#")) return `/${suffix}`;
  return null;
}

function joinPrefixedPath(prefix: string, suffix: string): string {
  if (!prefix) return suffix;
  if (suffix === "/") return prefix;
  if (suffix.startsWith("/?") || suffix.startsWith("/#")) {
    return `${prefix}${suffix.slice(1)}`;
  }
  return `${prefix}${suffix}`;
}

/**
 * Keep authored MDX links inside the active docs surface.
 *
 * Framework-scoped pages rewrite root-relative docs links into the
 * framework namespace (`/quickstart` -> `/mastra/quickstart`). Root pages do
 * the inverse for the default framework and legacy integration prefix
 * (`/built-in-agent/quickstart`, `/integrations/built-in-agent/quickstart`
 * -> `/quickstart`).
 */
export function resolveDocsHref(
  href: string | undefined,
  {
    slugHrefPrefix,
    frameworkOverride,
    linkNamespaceFramework,
  }: ResolveDocsHrefOptions,
): string | undefined {
  if (!href) return href;
  if (!href.startsWith("/") || href.startsWith("//")) return href;

  const hasExplicitLinkNamespace = linkNamespaceFramework !== undefined;
  if (hasExplicitLinkNamespace && linkNamespaceFramework === null) {
    return href;
  }

  const linkRewriteFramework = hasExplicitLinkNamespace
    ? linkNamespaceFramework
    : (frameworkOverride ?? (slugHrefPrefix === "" ? ROOT_FRAMEWORK : null));

  const rootFrameworkPath = stripPathPrefix(href, `/${ROOT_FRAMEWORK}`);
  if (rootFrameworkPath !== null) {
    return hasExplicitLinkNamespace && slugHrefPrefix
      ? joinPrefixedPath(slugHrefPrefix, rootFrameworkPath)
      : rootFrameworkPath;
  }

  const legacyIntegrationPath = stripPathPrefix(
    href,
    `/integrations/${ROOT_FRAMEWORK}`,
  );
  if (legacyIntegrationPath !== null) {
    return hasExplicitLinkNamespace && slugHrefPrefix
      ? joinPrefixedPath(slugHrefPrefix, legacyIntegrationPath)
      : legacyIntegrationPath;
  }

  const activeBackendPath = frameworkOverride
    ? stripPathPrefix(href, `/${frameworkOverride}`)
    : null;
  if (
    hasExplicitLinkNamespace &&
    activeBackendPath !== null &&
    slugHrefPrefix
  ) {
    return joinPrefixedPath(slugHrefPrefix, activeBackendPath);
  }

  const firstSegment = href.slice(1).split(/[/?#]/, 1)[0];
  if (!linkRewriteFramework) return href;

  const frameworkPath = `/${linkRewriteFramework}`;
  const sameFrameworkPath = stripPathPrefix(href, frameworkPath);
  const targetsAnotherFramework =
    firstSegment !== undefined &&
    CROSS_FRAMEWORK_SLUGS.has(firstSegment) &&
    firstSegment !== linkRewriteFramework;
  const targetsReservedRoute =
    firstSegment !== undefined && RESERVED_ROUTE_SLUG_SET.has(firstSegment);
  const targetsRedirectAlias = matchesSeoRedirectSource(href);

  if (slugHrefPrefix === "") {
    return sameFrameworkPath ?? href;
  }

  if (sameFrameworkPath !== null) {
    return joinPrefixedPath(slugHrefPrefix, sameFrameworkPath);
  }

  if (
    !targetsAnotherFramework &&
    !targetsReservedRoute &&
    !targetsRedirectAlias
  ) {
    return joinPrefixedPath(slugHrefPrefix, href);
  }

  return href;
}

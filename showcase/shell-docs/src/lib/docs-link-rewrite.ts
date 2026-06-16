import { getIntegrations, ROOT_FRAMEWORK } from "@/lib/registry";
import { RESERVED_ROUTE_SLUGS } from "@/lib/reserved-route-slugs";

const CROSS_FRAMEWORK_SLUGS: ReadonlySet<string> = new Set<string>([
  ...getIntegrations().map((i) => i.slug),
  "a2a",
  "agent-spec",
  "deepagents",
]);

const RESERVED_ROUTE_SLUG_SET: ReadonlySet<string> = new Set<string>(
  RESERVED_ROUTE_SLUGS as readonly string[],
);

const REDIRECT_ALIAS_ROOT_SLUGS: ReadonlySet<string> = new Set<string>([
  "ag-ui-protocol",
  "docs",
  "integrations",
]);

export interface ResolveDocsHrefOptions {
  slugHrefPrefix: string;
  frameworkOverride?: string | null;
}

function stripPathPrefix(href: string, prefix: string): string | null {
  if (href === prefix) return "/";
  if (!href.startsWith(prefix)) return null;

  const suffix = href.slice(prefix.length);
  if (suffix.startsWith("/")) return suffix;
  if (suffix.startsWith("?") || suffix.startsWith("#")) return `/${suffix}`;
  return null;
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
  { slugHrefPrefix, frameworkOverride }: ResolveDocsHrefOptions,
): string | undefined {
  if (!href) return href;
  if (!href.startsWith("/") || href.startsWith("//")) return href;

  const rootFrameworkPath = stripPathPrefix(href, `/${ROOT_FRAMEWORK}`);
  if (rootFrameworkPath !== null) return rootFrameworkPath;

  const legacyIntegrationPath = stripPathPrefix(
    href,
    `/integrations/${ROOT_FRAMEWORK}`,
  );
  if (legacyIntegrationPath !== null) return legacyIntegrationPath;

  const firstSegment = href.slice(1).split(/[/?#]/, 1)[0];
  const linkRewriteFramework =
    frameworkOverride ?? (slugHrefPrefix === "" ? ROOT_FRAMEWORK : null);
  if (!linkRewriteFramework) return href;

  const frameworkPath = `/${linkRewriteFramework}`;
  const sameFrameworkPath = stripPathPrefix(href, frameworkPath);
  const targetsAnotherFramework =
    firstSegment !== undefined &&
    CROSS_FRAMEWORK_SLUGS.has(firstSegment) &&
    firstSegment !== linkRewriteFramework;
  const targetsReservedRoute =
    firstSegment !== undefined && RESERVED_ROUTE_SLUG_SET.has(firstSegment);
  const targetsRedirectAlias =
    firstSegment !== undefined && REDIRECT_ALIAS_ROOT_SLUGS.has(firstSegment);

  if (slugHrefPrefix === "") {
    return sameFrameworkPath ?? href;
  }

  if (
    sameFrameworkPath === null &&
    !targetsAnotherFramework &&
    !targetsReservedRoute &&
    !targetsRedirectAlias
  ) {
    return `/${linkRewriteFramework}${href}`;
  }

  return href;
}

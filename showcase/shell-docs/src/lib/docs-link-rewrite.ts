import { getIntegrations, ROOT_FRAMEWORK } from "@/lib/registry";
import {
  FRONTEND_PAGE_IDS,
  getFrontendCanonicalSlug,
} from "@/lib/frontend-page-content";
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

function canonicalAngularHref(href: string): string {
  const suffixIndex = href.search(/[?#]/);
  const pathname = suffixIndex === -1 ? href : href.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? "" : href.slice(suffixIndex);
  const slugPath = pathname.replace(/^\/+|\/+$/g, "");
  const canonicalSlug = getFrontendCanonicalSlug("angular", slugPath);
  return canonicalSlug ? `/${canonicalSlug}${suffix}` : `/${suffix}`;
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
  const activeAngularPath = stripPathPrefix(slugHrefPrefix, "/angular");
  if (activeAngularPath !== null) {
    const sameAngularPath = stripPathPrefix(href, "/angular");
    const targetsAnotherFrontend = FRONTEND_PAGE_IDS.some(
      (frontend) =>
        frontend !== "angular" &&
        stripPathPrefix(href, `/${frontend}`) !== null,
    );
    const targetsReservedRoute =
      firstSegment !== undefined && RESERVED_ROUTE_SLUG_SET.has(firstSegment);

    if (targetsAnotherFrontend || targetsReservedRoute) return href;

    const angularHref = canonicalAngularHref(sameAngularPath ?? href);
    const angularFirstSegment = angularHref.slice(1).split(/[/?#]/, 1)[0];
    const targetsAnotherBackend =
      sameAngularPath === null &&
      angularFirstSegment !== undefined &&
      CROSS_FRAMEWORK_SLUGS.has(angularFirstSegment);
    const targetsRootOnlyPage =
      sameAngularPath === null && angularHref === "/model-selection";

    return joinPrefixedPath(
      targetsAnotherBackend || targetsRootOnlyPage
        ? "/angular"
        : slugHrefPrefix,
      angularHref,
    );
  }

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

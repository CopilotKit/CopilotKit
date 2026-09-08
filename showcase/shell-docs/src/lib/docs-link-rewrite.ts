import { getIntegrations, ROOT_FRAMEWORK } from "@/lib/registry";
import {
  FRONTEND_PAGE_IDS,
  getFrontendCanonicalSlug,
} from "@/lib/frontend-page-content";
import {
  channelGuideHref,
  getChannelGuidePublicSlug,
} from "@/lib/channel-guide-routes";
import { isChannelFrontend } from "@/lib/frontend-options";
import type { FrontendId } from "@/lib/frontend-options";
import { referenceVersionHref } from "@/lib/reference-items";
import {
  GLOBAL_DOCS_ROUTE_SLUGS,
  RESERVED_ROUTE_SLUGS,
} from "@/lib/reserved-route-slugs";
import { matchesSeoRedirectSource } from "@/lib/seo-redirects";

const CROSS_FRAMEWORK_SLUGS: ReadonlySet<string> = new Set<string>([
  ...getIntegrations().map((i) => i.slug),
  "a2a",
  "agent-spec",
  "deepagents",
]);

// These destinations belong to a global docs surface and must not inherit the
// active frontend/framework prefix. `channels` is authored content rather than
// a reserved Next.js route, so it is scoped here instead of in
// RESERVED_ROUTE_SLUGS.
const UNSCOPED_ROUTE_SLUG_SET: ReadonlySet<string> = new Set<string>([
  ...RESERVED_ROUTE_SLUGS,
  ...GLOBAL_DOCS_ROUTE_SLUGS,
] as readonly string[]);

export interface ResolveDocsHrefOptions {
  slugHrefPrefix: string;
  frameworkOverride?: string | null;
  frontendOverride?: FrontendId;
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

function resolveVueReferenceHref(href: string): string | null {
  const referencePath = stripPathPrefix(href, "/reference");
  if (referencePath === null) return null;

  const suffixIndex = referencePath.search(/[?#]/);
  const pathname =
    suffixIndex === -1 ? referencePath : referencePath.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? "" : referencePath.slice(suffixIndex);
  const rootReactPath = pathname.replace(/^\/v2(?:\/|$)/, "/");

  if (
    /^\/(?:v1|react-native|vue|angular|core|channels)(?:\/|$)/.test(pathname)
  ) {
    return null;
  }

  return `${referenceVersionHref("vue", rootReactPath)}${suffix}`;
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
    frontendOverride,
  }: ResolveDocsHrefOptions,
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

  if (frontendOverride === "vue") {
    const vueReferenceHref = resolveVueReferenceHref(href);
    if (vueReferenceHref) return vueReferenceHref;
  }

  if (frontendOverride && isChannelFrontend(frontendOverride)) {
    const sameFrontendPath = stripPathPrefix(href, `/${frontendOverride}`);
    if (sameFrontendPath !== null) {
      const explicitRootFrameworkPath = stripPathPrefix(
        sameFrontendPath,
        `/${ROOT_FRAMEWORK}`,
      );
      if (explicitRootFrameworkPath !== null) {
        return joinPrefixedPath(
          `/${frontendOverride}`,
          explicitRootFrameworkPath,
        );
      }

      if (
        sameFrontendPath === "/" ||
        sameFrontendPath === "/connect" ||
        sameFrontendPath.startsWith("/?") ||
        sameFrontendPath.startsWith("/#") ||
        sameFrontendPath.startsWith("/connect?") ||
        sameFrontendPath.startsWith("/connect#")
      ) {
        return joinPrefixedPath(slugHrefPrefix, sameFrontendPath);
      }

      return href;
    }

    const explicitOtherFrontendDestination = FRONTEND_PAGE_IDS.some(
      (frontend) =>
        frontend !== frontendOverride &&
        stripPathPrefix(href, `/${frontend}`) !== null,
    );
    if (explicitOtherFrontendDestination) return href;

    const channelPath = stripPathPrefix(href, "/channels");
    if (
      channelPath !== null &&
      !channelPath.startsWith("/?") &&
      !channelPath.startsWith("/#")
    ) {
      const suffixIndex = channelPath.search(/[?#]/);
      const pathname =
        suffixIndex === -1 ? channelPath : channelPath.slice(0, suffixIndex);
      const suffix = suffixIndex === -1 ? "" : channelPath.slice(suffixIndex);
      const publicSlug = getChannelGuidePublicSlug(
        pathname === "/" ? "channels" : `channels${pathname}`,
      );

      if (publicSlug) {
        return `${channelGuideHref(
          frontendOverride,
          frameworkOverride,
          publicSlug,
        )}${suffix}`;
      }
    }

    // Framework-prefixed setup links already target their canonical global
    // docs journey. Only unprefixed links inherit a non-default channel
    // framework; Built-in Agent itself lives on the global root surface.
    const targetsExplicitFramework =
      firstSegment !== undefined && CROSS_FRAMEWORK_SLUGS.has(firstSegment);
    const targetsUniversalDocsRoute = firstSegment === "agentic-protocols";
    if (
      targetsExplicitFramework ||
      targetsUniversalDocsRoute ||
      frameworkOverride === ROOT_FRAMEWORK
    ) {
      return href;
    }
  }

  const activeAngularPath = stripPathPrefix(slugHrefPrefix, "/angular");
  if (activeAngularPath !== null) {
    const sameAngularPath = stripPathPrefix(href, "/angular");
    const targetsAnotherFrontend = FRONTEND_PAGE_IDS.some(
      (frontend) =>
        frontend !== "angular" &&
        stripPathPrefix(href, `/${frontend}`) !== null,
    );
    const targetsReservedRoute =
      firstSegment !== undefined && UNSCOPED_ROUTE_SLUG_SET.has(firstSegment);

    if (targetsAnotherFrontend || targetsReservedRoute) return href;

    if (sameAngularPath !== null) {
      const explicitBackend = sameAngularPath.slice(1).split(/[/?#]/, 1)[0];
      if (explicitBackend && CROSS_FRAMEWORK_SLUGS.has(explicitBackend)) {
        const backendRelativePath =
          stripPathPrefix(sameAngularPath, `/${explicitBackend}`) ?? "/";
        return joinPrefixedPath(
          `/angular/${explicitBackend}`,
          canonicalAngularHref(backendRelativePath),
        );
      }
    }

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
    firstSegment !== undefined && UNSCOPED_ROUTE_SLUG_SET.has(firstSegment);
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

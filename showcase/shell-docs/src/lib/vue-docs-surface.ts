import type { NavNode } from "./docs-render";

export const VUE_DOCS_DISPOSITIONS = [
  "shared",
  "excluded",
  "not-applicable",
] as const;

export type VueDocsDisposition = (typeof VUE_DOCS_DISPOSITIONS)[number];

export type VueDocsRootContent = {
  contentSlugPath: string;
  vueDocs?: unknown;
};

export type VueDocsVariantContent = {
  route: string;
  contentSlugPath: string;
};

export type VueDocsSurfaceSource = {
  resolveRootContent: (route: string) => VueDocsRootContent | null;
  vueVariants: readonly VueDocsVariantContent[];
  contentExists: (contentSlugPath: string) => boolean;
};

export type VueDocsProjectedPage = {
  route: string;
  canonicalPath: string;
  contentSlugPath: string;
  source: "vue-variant" | "shared";
};

export type VueDocsSurfaceProjection = {
  navTree: NavNode[];
  pages: VueDocsProjectedPage[];
};

export type VueDocsSurfaceDiagnosticCode =
  | "conflicting-content"
  | "duplicate-content"
  | "duplicate-route"
  | "invalid-disposition"
  | "missing-root-content"
  | "missing-selected-content"
  | "orphan-content"
  | "unclassified-route";

export type VueDocsSurfaceDiagnostic = {
  code: VueDocsSurfaceDiagnosticCode;
  route: string;
  contentSlugPath?: string;
  detail: string;
};

export class VueDocsSurfaceProjectionError extends Error {
  constructor(public readonly diagnostics: readonly VueDocsSurfaceDiagnostic[]) {
    super(
      [
        `Vue docs surface projection failed with ${diagnostics.length} diagnostic(s):`,
        ...diagnostics.map(
          (diagnostic) =>
            `[${diagnostic.code}] ${diagnostic.route}: ${diagnostic.detail}`,
        ),
      ].join("\n"),
    );
    this.name = "VueDocsSurfaceProjectionError";
  }
}

function normalizeRoute(route: string): string {
  return route.replace(/^\/+|\/+$/g, "");
}

function isVueDocsDisposition(value: unknown): value is VueDocsDisposition {
  return (
    typeof value === "string" &&
    (VUE_DOCS_DISPOSITIONS as readonly string[]).includes(value)
  );
}

function canonicalPath(route: string): string {
  return route === "quickstart" ? "/vue" : `/vue/${route}`;
}

function collectContractRoutes(navTree: readonly NavNode[]): string[] {
  const routes: string[] = [];

  for (const node of navTree) {
    if (node.type === "page") {
      const route = normalizeRoute(node.slug);
      if (route) routes.push(route);
    } else if (node.type === "group") {
      routes.push(...collectContractRoutes(node.children));
    }
  }

  return routes;
}

function pruneEmptySections(navTree: NavNode[]): NavNode[] {
  return navTree.filter((node, index) => {
    if (node.type !== "section") return true;

    for (let next = index + 1; next < navTree.length; next++) {
      if (navTree[next].type === "section") return false;
      return true;
    }

    return false;
  });
}

function sortDiagnostics(
  diagnostics: VueDocsSurfaceDiagnostic[],
  routeOrder: ReadonlyMap<string, number>,
): VueDocsSurfaceDiagnostic[] {
  return diagnostics.sort((left, right) => {
    const leftOrder = routeOrder.get(left.route) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = routeOrder.get(right.route) ?? Number.MAX_SAFE_INTEGER;
    return (
      leftOrder - rightOrder ||
      left.route.localeCompare(right.route) ||
      left.code.localeCompare(right.code) ||
      (left.contentSlugPath ?? "").localeCompare(right.contentSlugPath ?? "")
    );
  });
}

/**
 * Project the rendered root documentation contract into a Vue-owned surface.
 *
 * This function performs no filesystem access and has no production route
 * consumers. Callers inject the selected root content, Vue variant inventory,
 * and content-existence checks.
 */
export function projectVueDocsSurface(
  rootNavTree: readonly NavNode[],
  source: VueDocsSurfaceSource,
): VueDocsSurfaceProjection {
  const contractRoutes = collectContractRoutes(rootNavTree);
  const routeOrder = new Map<string, number>();
  contractRoutes.forEach((route, index) => {
    if (!routeOrder.has(route)) routeOrder.set(route, index);
  });

  const diagnostics: VueDocsSurfaceDiagnostic[] = [];
  const variantsByRoute = new Map<string, VueDocsVariantContent[]>();

  for (const variant of source.vueVariants) {
    const route = normalizeRoute(variant.route);
    const variants = variantsByRoute.get(route) ?? [];
    variants.push({ ...variant, route });
    variantsByRoute.set(route, variants);

    if (!routeOrder.has(route)) {
      diagnostics.push({
        code: "orphan-content",
        route,
        contentSlugPath: variant.contentSlugPath,
        detail: "Vue content does not map to a rendered root route",
      });
    }
  }

  for (const [route, variants] of variantsByRoute) {
    if (variants.length > 1) {
      diagnostics.push({
        code: "duplicate-content",
        route,
        detail: `multiple Vue content files map to this route: ${variants
          .map((variant) => variant.contentSlugPath)
          .join(", ")}`,
      });
    }
  }

  const projectedPages: VueDocsProjectedPage[] = [];
  const seenRoutes = new Set<string>();

  const projectNodes = (nodes: readonly NavNode[]): NavNode[] => {
    const projected: NavNode[] = [];

    for (const node of nodes) {
      if (node.type === "section") {
        projected.push({ ...node });
        continue;
      }

      if (node.type === "group") {
        const children = projectNodes(node.children);
        if (children.length > 0) {
          projected.push({ ...node, children });
        }
        continue;
      }

      const route = normalizeRoute(node.slug);
      if (!route) continue;

      if (seenRoutes.has(route)) {
        diagnostics.push({
          code: "duplicate-route",
          route,
          detail: "the rendered root navigation contains this route more than once",
        });
        continue;
      }
      seenRoutes.add(route);

      const rootContent = source.resolveRootContent(route);
      const variants = variantsByRoute.get(route) ?? [];
      const disposition = rootContent?.vueDocs;

      if (disposition !== undefined && !isVueDocsDisposition(disposition)) {
        diagnostics.push({
          code: "invalid-disposition",
          route,
          contentSlugPath: rootContent?.contentSlugPath,
          detail: `expected shared, excluded, or not-applicable; received ${JSON.stringify(
            disposition,
          )}`,
        });
        continue;
      }

      if (variants.length === 1 && disposition !== undefined) {
        diagnostics.push({
          code: "conflicting-content",
          route,
          contentSlugPath: variants[0].contentSlugPath,
          detail: `Vue variant conflicts with the root ${disposition} disposition`,
        });
        continue;
      }

      if (variants.length > 1) continue;

      let selectedContentSlug: string | null = null;
      let selectedSource: VueDocsProjectedPage["source"] | null = null;

      if (variants.length === 1) {
        selectedContentSlug = variants[0].contentSlugPath;
        selectedSource = "vue-variant";
      } else if (!rootContent) {
        diagnostics.push({
          code: "missing-root-content",
          route,
          detail: "the rendered route has no resolvable root content",
        });
        continue;
      } else if (disposition === undefined) {
        diagnostics.push({
          code: "unclassified-route",
          route,
          contentSlugPath: rootContent.contentSlugPath,
          detail: "add a Vue variant or an explicit root content disposition",
        });
        continue;
      } else if (disposition === "shared") {
        selectedContentSlug = rootContent.contentSlugPath;
        selectedSource = "shared";
      } else {
        continue;
      }

      if (!source.contentExists(selectedContentSlug)) {
        diagnostics.push({
          code: "missing-selected-content",
          route,
          contentSlugPath: selectedContentSlug,
          detail: "the selected Vue documentation content does not exist",
        });
        continue;
      }

      const pageCanonicalPath = canonicalPath(route);
      projectedPages.push({
        route,
        canonicalPath: pageCanonicalPath,
        contentSlugPath: selectedContentSlug,
        source: selectedSource,
      });
      projected.push({
        ...node,
        slug: route === "quickstart" ? "" : node.slug,
        href: pageCanonicalPath,
      });
    }

    return pruneEmptySections(projected);
  };

  const navTree = projectNodes(rootNavTree);

  if (diagnostics.length > 0) {
    throw new VueDocsSurfaceProjectionError(
      sortDiagnostics(diagnostics, routeOrder),
    );
  }

  return { navTree, pages: projectedPages };
}

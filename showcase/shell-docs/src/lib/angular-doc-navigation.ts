import {
  buildFrameworkNav,
  buildFrameworkOnlyNav,
  buildRootSurfaceNav,
  loadDoc,
} from "./docs-render";
import type { NavNode } from "./docs-render";
import {
  ANGULAR_GUIDE_PAGES,
  getFrontendCanonicalSlug,
  getFrontendReferenceSlug,
} from "./frontend-page-content";
import { isFrontendFirstClassDoc } from "./frontend-doc-policy";
import {
  getDocsFolder,
  getDocsMode,
  getIntegration,
  ROOT_FRAMEWORK,
} from "./registry";

export interface AngularDocResolution {
  slugPath: string;
  contentSlugPath: string;
  framework: string;
  source: "angular" | "backend" | "shared";
}

function backendNavTree(framework: string): NavNode[] {
  const folder = getDocsFolder(framework);
  if (framework === ROOT_FRAMEWORK) return buildRootSurfaceNav(folder);

  if (getDocsMode(framework) === "authored") {
    return buildFrameworkOnlyNav(folder);
  }

  return buildFrameworkNav(
    folder,
    getIntegration(framework)?.name ?? framework,
    framework,
  );
}

function frameworkContentSlug(
  framework: string,
  slugPath: string,
): string | null {
  const frameworkSlug = `integrations/${getDocsFolder(framework)}/${slugPath}`;
  const frameworkDoc = loadDoc(frameworkSlug);
  const sharedContentSlug = [
    slugPath,
    ...(slugPath.startsWith("(other)/") ? [] : [`(other)/${slugPath}`]),
  ].find(
    (candidate) =>
      isFrontendFirstClassDoc("angular", candidate) && loadDoc(candidate),
  );
  const sharedDoc = sharedContentSlug ? loadDoc(sharedContentSlug) : null;

  if (getDocsMode(framework) === "authored") {
    if (sharedDoc) return sharedContentSlug ?? null;
    return frameworkDoc ? frameworkSlug : null;
  }

  if (sharedDoc) return sharedContentSlug ?? null;
  return frameworkDoc ? frameworkSlug : null;
}

export function resolveAngularDoc(
  backendFramework: string | null,
  slugPath: string,
): AngularDocResolution | null {
  const angularContentSlug =
    slugPath === "using-these-docs"
      ? "frontends/angular/docs-status"
      : `frontends/angular/${slugPath}`;
  if (loadDoc(angularContentSlug)) {
    return {
      slugPath,
      contentSlugPath: angularContentSlug,
      framework: backendFramework ?? ROOT_FRAMEWORK,
      source: "angular",
    };
  }

  const framework = backendFramework ?? ROOT_FRAMEWORK;
  const contentSlugPath = frameworkContentSlug(framework, slugPath);
  if (!contentSlugPath) return null;

  return {
    slugPath,
    contentSlugPath,
    framework,
    source: contentSlugPath.startsWith("integrations/") ? "backend" : "shared",
  };
}

function filterResolvableAngularNodes(
  nodes: NavNode[],
  backendFramework: string | null,
  publishedSlugs: Set<string>,
): NavNode[] {
  const filtered = nodes.flatMap((node): NavNode[] => {
    if (node.type === "page") {
      if (node.slug === "" || node.slug === "quickstart") return [];
      const canonicalSlug = getFrontendCanonicalSlug("angular", node.slug);
      if (publishedSlugs.has(canonicalSlug)) {
        return [];
      }
      if (!resolveAngularDoc(backendFramework, canonicalSlug)) return [];
      publishedSlugs.add(canonicalSlug);
      return [{ ...node, slug: canonicalSlug }];
    }

    if (node.type === "group") {
      const children = filterResolvableAngularNodes(
        node.children,
        backendFramework,
        publishedSlugs,
      );
      return children.length > 0 ? [{ ...node, children }] : [];
    }

    return [node];
  });

  return filtered.filter((node, index) => {
    if (node.type !== "section") return true;
    return (
      filtered[index + 1] !== undefined &&
      filtered[index + 1]?.type !== "section"
    );
  });
}

export function getAngularDocsNavTree(
  backendFramework: string | null,
): NavNode[] {
  const prefixPages: NavNode[] = [
    { type: "section", title: "Getting Started", icon: "lucide/Rocket" },
    {
      type: "page",
      title: backendFramework ? "Backend overview" : "Angular quickstart",
      slug: "",
    },
    ...(backendFramework
      ? ([
          { type: "page", title: "Angular quickstart", slug: "quickstart" },
        ] satisfies NavNode[])
      : []),
    {
      type: "page",
      title: "Using the Angular docs",
      slug: "using-these-docs",
    },
    { type: "page", title: "Feature examples", slug: "features" },
    {
      type: "page",
      title: "Angular API reference",
      slug: getFrontendReferenceSlug("angular"),
      href: `/${getFrontendReferenceSlug("angular")}`,
    },
    { type: "section", title: "Angular Guides", icon: "lucide/BookOpen" },
    ...ANGULAR_GUIDE_PAGES.map(
      (guide): NavNode => ({
        type: "page",
        title: guide.title,
        slug: guide.slug,
      }),
    ),
  ];

  const backendNodes = filterResolvableAngularNodes(
    backendNavTree(backendFramework ?? ROOT_FRAMEWORK),
    backendFramework,
    new Set(
      prefixPages.flatMap((node) =>
        node.type === "page" && !node.href ? [node.slug] : [],
      ),
    ),
  );

  return [...prefixPages, ...backendNodes];
}

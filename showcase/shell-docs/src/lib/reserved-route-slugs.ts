// Top-level route segments in src/app/ that must not be mistaken for
// framework slugs by FrameworkProvider.urlFramework. If an integration
// registry entry ever ships a slug colliding with one of these, the
// framework URL-resolver would otherwise hijack the route.
export const RESERVED_ROUTE_SLUGS = [
  "docs",
  "ag-ui",
  "reference",
  "frontends",
  "api",
] as const;

// Authored docs trees that live on a single global surface instead of being
// multiplied beneath every agent-framework URL. Keep this separate from
// RESERVED_ROUTE_SLUGS: these paths are resolved by the dynamic docs route,
// not by a dedicated top-level Next.js route.
export const GLOBAL_DOCS_ROUTE_SLUGS = ["channels"] as const;

export function isGlobalDocsPath(slugPath: string): boolean {
  const [firstSegment] = slugPath.split("/").filter(Boolean);
  return (GLOBAL_DOCS_ROUTE_SLUGS as readonly string[]).includes(
    firstSegment ?? "",
  );
}

// Canonical category ordering for the framework picker / integrations
// grid / sidebar framework selector. Defined in its own module so both
// server components (app routes, MDX-side renderers) and client
// components (DocsLandingNext, FrameworkSelector) can import it
// without pulling the fs-using helpers in lib/docs-render through.
//
// Re-exported from lib/docs-render so existing server-side imports keep
// working — change in one place, available everywhere.

export const FRAMEWORK_CATEGORY_ORDER = [
  "popular",
  "agent-framework",
  "provider-sdk",
  "enterprise-platform",
  "protocol",
  "emerging",
  "starter",
] as const;

export type FrameworkCategory = (typeof FRAMEWORK_CATEGORY_ORDER)[number];

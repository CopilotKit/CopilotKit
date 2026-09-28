// Canonical category ordering for the framework picker / integrations
// grid / sidebar framework selector. Defined in its own module so it can
// be imported without pulling the fs-using helpers in lib/docs-render
// through — sidebar-framework-selector.tsx is today's consumer, via the
// re-export below.
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

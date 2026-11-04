// Single source of truth for chat-driven workspace navigation.
//
// The copilot's `navigate_to` frontend tool uses PAGE_KEYS as its parameter
// enum and pageToRoute() to resolve the target route, so the set of pages the
// agent may open and the routes they map to can never drift apart.

export const PAGE_ROUTES = {
  dashboard: "/",
  pipeline: "/pipeline",
  products: "/products",
  accounts: "/accounts",
  contacts: "/contacts",
  team: "/team",
  reports: "/reports",
  activity: "/activity",
} as const;

export type PageKey = keyof typeof PAGE_ROUTES;

/** Page keys as a non-empty tuple, suitable for `z.enum(PAGE_KEYS)`. */
export const PAGE_KEYS = Object.keys(PAGE_ROUTES) as [PageKey, ...PageKey[]];

/** Resolve a page key to its route. Unknown keys fall back to the dashboard ("/"). */
export function pageToRoute(page: string): string {
  return (PAGE_ROUTES as Record<string, string>)[page] ?? "/";
}

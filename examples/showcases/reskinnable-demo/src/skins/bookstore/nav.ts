import type { NavRoute } from "@/shell/skin-contract";

/**
 * `nav` is VISIBLE navigation only — `resolvePage` in skin.tsx is the source
 * of truth for which segments are valid, and it additionally accepts the
 * parameterized route `book/<slug>`, which is reachable by click-through and
 * by the agent rather than from the nav.
 */
export const bookstoreNav: NavRoute[] = [
  { segment: "", label: "Browse" },
  { segment: "cart", label: "Cart" },
];

"use client";

import type { ComponentType } from "react";
import type { Skin } from "@/shell/skin-contract";
import { bookstoreIdentity } from "@/skins/bookstore/identity";
import { bookstoreNav } from "@/skins/bookstore/nav";
import { BookstoreLayout } from "@/skins/bookstore/layout";
import { BookstoreTools } from "@/skins/bookstore/tools";
import {
  BookstoreRuntimeProviders,
  useBookstoreRuntimeProperties,
} from "@/skins/bookstore/providers";
import { bookstoreCatalog } from "@/skins/bookstore/catalog";
import { bookstoreSuggestions } from "@/skins/bookstore/suggestions";
import { BOOKSTORE_DESIGN_SKILL } from "@/skins/bookstore/design-skill";
import { useBookstoreData } from "@/skins/bookstore/data/use-data";
import { BrowsePage } from "@/skins/bookstore/pages/browse";
import { BookPage } from "@/skins/bookstore/pages/book";
import { CartPage } from "@/skins/bookstore/pages/cart";

/**
 * Single-segment routes. The parameterized `book/<slug>` route is handled
 * below, outside this map.
 *
 * A `Map` (not a plain object) is load-bearing for security: `segments` comes
 * straight from the URL path after `/bookstore`, so `segments[0]` is
 * untrusted caller input. A plain-object lookup (`PAGES[segments[0]]`) walks
 * the prototype chain, so `"constructor"`, `"toString"`, `"valueOf"`,
 * `"hasOwnProperty"`, `"__proto__"`, … all resolve truthy and slip past the
 * `?? null` 404 guard — handing the shell a `Function` where a `ComponentType`
 * is declared, so `/bookstore/constructor` renders a Function and React
 * crashes instead of showing a 404. `Map.get` only ever sees own entries,
 * making that bad state unrepresentable rather than relying on a per-call-site
 * guard. Mirrors keel's `PAGES` map in `src/skins/keel/skin.tsx`.
 */
const PAGES: Map<string, ComponentType> = new Map([
  ["", BrowsePage],
  ["browse", BrowsePage],
  ["cart", CartPage],
]);

/**
 * `[]` and `["browse"]` both fold onto `BrowsePage` — the index route IS the
 * shelf, and `layout.tsx`'s `ROUTE_READABLE_NAME` map already assumes both
 * spellings resolve to the same page.
 *
 * `book/<slug>` always resolves to `BookPage`, deliberately WITHOUT checking
 * whether the slug exists. An unknown slug is a valid route with a
 * "not found" body (rendered inside `BookPage`), not a 404 — the agent hands
 * out these links, and 404ing a renamed book would break a deep link.
 * `BookPage` reads its own slug from `useBookstoreSegments()[1]`.
 */
function resolvePage(segments: string[]): ComponentType | null {
  if (segments.length === 0) return BrowsePage;
  if (segments.length === 1) return PAGES.get(segments[0]) ?? null;
  if (segments.length === 2 && segments[0] === "book") return BookPage;
  return null;
}

/**
 * Human-readable tool-activity chip labels, present-participle voice to match
 * the shipped skins. Covers this skin's six frontend tools — verify against
 * `tools.tsx` if this list and that file ever disagree.
 */
const TOOL_LABELS: Record<string, string> = {
  showBooks: "Showing books",
  recommendBooks: "Recommending books",
  browseWithFilters: "Filtering the shelf",
  addToCart: "Adding to your cart",
  openCheckout: "Opening checkout",
  openBook: "Opening the book",
};

// NOTE: no `agent` field — agents are server-only, registered in
// src/shell/agent-registry.ts under this same id ("bookstore"). This module
// must NEVER import agent.ts.
const bookstore: Skin = {
  id: "bookstore",
  identity: bookstoreIdentity,
  themeClass: "theme-bookstore",
  Layout: BookstoreLayout,
  nav: bookstoreNav,
  resolvePage,
  Tools: BookstoreTools,
  catalog: bookstoreCatalog,
  suggestions: bookstoreSuggestions,
  designSkill: BOOKSTORE_DESIGN_SKILL,
  toolLabels: TOOL_LABELS,
  // Persona lives ABOVE CopilotKitProvider so identity flows through the
  // provider's `properties` prop rather than a child racing setProperties.
  RuntimeProviders: BookstoreRuntimeProviders,
  useRuntimeProperties: useBookstoreRuntimeProperties,
  useData: useBookstoreData,
  // `Providers` omitted — nothing in this skin needs to mount below the
  // provider. `CanvasSurface` and `sandboxFunctions` omitted — no canvas, no
  // OGUI beat (spec §10). `chatHeaderActions` and `onSuggestionSelect`
  // omitted — no attachment beat here (that is banking's Q2 invoice);
  // deferred for this skin.
};

export default bookstore;

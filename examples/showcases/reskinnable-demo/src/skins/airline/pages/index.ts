import type { ComponentType } from "react";
import { TripsPage } from "./trips";
import { AccountPage } from "./account";
import { RebookPage } from "./rebook";
import { LoyaltyPage } from "./loyalty";
import { DisruptionsPage } from "./disruptions";

/**
 * Aeronova's route table. `skin.tsx` sets `resolvePage: resolveAirlinePage`, so
 * this — not `nav` — is the source of truth for which segments are valid.
 *
 * ⚠️ A `Map`, NOT a plain object. `resolvePage` receives untrusted URL segments,
 * and an object literal indexed by them walks the prototype chain: `/airline/
 * constructor` returns `Object.prototype.constructor`, which is a truthy
 * `Function` and slips straight past the shell's `if (!Page) notFound()` guard
 * in `src/app/[skin]/[[...rest]]/page.tsx` — a 500 where a 404 belongs. Keel and
 * commerce were re-keyed for this; `../skin.test.tsx` pins it here.
 */
const PAGES = new Map<string, ComponentType>([
  ["", TripsPage],
  ["account", AccountPage],
  ["rebook", RebookPage],
  ["loyalty", LoyaltyPage],
  ["disruptions", DisruptionsPage],
]);

export function resolveAirlinePage(segments: string[]): ComponentType | null {
  const key = segments.length === 0 ? "" : segments.join("/");
  return PAGES.get(key) ?? null;
}

export { TripsPage, AccountPage, RebookPage, LoyaltyPage, DisruptionsPage };

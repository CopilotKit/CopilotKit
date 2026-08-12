import type { ComponentType } from "react";
import { TripsPage } from "./trips";
import { AccountPage } from "./account";
import { RebookPage } from "./rebook";
import { LoyaltyPage } from "./loyalty";
import { DisruptionsPage } from "./disruptions";

/**
 * Aeronova's route table, lifted out of `skin.tsx` so this slot can add the two
 * REST-backed pages without editing a file it does not own.
 *
 * ⚠️ NOT WIRED YET. `skin.tsx` still declares its own `PAGES` literal covering
 * only the three in-memory pages, so `/airline/account` and `/airline/rebook`
 * 404 until a later slot swaps that literal for `resolvePage:
 * resolveAirlinePage` (and `nav: airlineNav`, from `../nav`). See
 * `ledger-context.tsx`'s header for the full three-edit wiring note — the
 * provider mount is part of the same change, because both new pages call
 * `useAirlineLedger()` and it throws outside its provider.
 *
 * The first three entries are field-for-field what `skin.tsx` resolves today,
 * so the swap is additive and cannot silently retarget an existing route.
 */
const PAGES: Record<string, ComponentType> = {
  "": TripsPage,
  account: AccountPage,
  rebook: RebookPage,
  loyalty: LoyaltyPage,
  disruptions: DisruptionsPage,
};

export function resolveAirlinePage(segments: string[]): ComponentType | null {
  const key = segments.length === 0 ? "" : segments.join("/");
  return PAGES[key] ?? null;
}

export { TripsPage, AccountPage, RebookPage, LoyaltyPage, DisruptionsPage };

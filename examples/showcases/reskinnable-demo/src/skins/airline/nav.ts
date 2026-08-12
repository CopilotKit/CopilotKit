import {
  Ticket,
  UserRound,
  PlaneTakeoff,
  Award,
  AlertTriangle,
} from "lucide-react";
import type { NavRoute } from "@/shell/skin-contract";

/**
 * Aeronova's nav, lifted out of `skin.tsx` so this slot can add the two
 * REST-backed pages without editing a file it does not own.
 *
 * ⚠️ NOT WIRED YET. `skin.tsx` still declares its nav inline, so the two new
 * entries below are invisible until a later slot swaps that literal for
 * `nav: airlineNav` (and `resolvePage: resolveAirlinePage`, from `./pages`).
 * See `ledger-context.tsx`'s header for the full three-edit wiring note.
 *
 * The first three entries are field-for-field what `skin.tsx` declares today —
 * same segments, same labels — so the swap is additive and cannot silently
 * rename a route someone has bookmarked. Icons are new: `skin.tsx`'s literal
 * carries none and `layout.tsx` falls back to its own `NAV_ICONS` map, which
 * has no entry for the two new segments.
 *
 * WHY BOTH A "Trip" AND A "Your account" ENTRY, which reads redundant at a
 * glance: they sit on the two different substrates the app is deliberately
 * proving (`CLAUDE.md` § "The six skins"). "Trip" is today's in-memory
 * check-in flow for AV1423 (`useAirlineData`); "Your account" is the REST
 * ledger — Camila's whole profile, every booking on it, and the saved
 * travellers. `data/beat-map.md` § "It is ADDITIVE" keeps both live until a
 * later slot migrates the in-memory pages, and this is what that transitional
 * state looks like in the sidebar.
 */
export const airlineNav: NavRoute[] = [
  { segment: "", label: "Trip", icon: Ticket },
  { segment: "account", label: "Your account", icon: UserRound },
  { segment: "rebook", label: "Rebook", icon: PlaneTakeoff },
  { segment: "loyalty", label: "Loyalty", icon: Award },
  { segment: "disruptions", label: "Disruptions", icon: AlertTriangle },
];

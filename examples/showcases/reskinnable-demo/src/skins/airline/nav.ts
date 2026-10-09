import {
  Ticket,
  UserRound,
  PlaneTakeoff,
  Award,
  AlertTriangle,
} from "lucide-react";
import type { NavRoute } from "@/shell/skin-contract";

/**
 * Aeronova's nav. `skin.tsx` sets `nav: airlineNav` and
 * `resolvePage: resolveAirlinePage` (from `./pages`), so the two lists are
 * declared once each and cannot describe two different apps.
 *
 * WHY BOTH A "Trip" AND A "Your account" ENTRY, which reads redundant at a
 * glance: they are two different views of ONE ledger, and both are demo
 * surfaces. "Trip" is the check-in flow for the account holder's next flight —
 * flight card, cabin map, boarding pass. "Your account" is the whole profile:
 * every booking on it, the saved travellers, and the fare condition on each
 * ticket, which is what beats 3b and 6 read. Both now come from
 * `GET /api/airline/v1/ledger`; the second in-memory seed the check-in pages
 * used to run on is gone (see `components/concierge-view.ts`).
 */
export const airlineNav: NavRoute[] = [
  { segment: "", label: "Trip", icon: Ticket },
  { segment: "account", label: "Your account", icon: UserRound },
  { segment: "rebook", label: "Rebook", icon: PlaneTakeoff },
  { segment: "loyalty", label: "Loyalty", icon: Award },
  { segment: "disruptions", label: "Disruptions", icon: AlertTriangle },
];

import { CreditCard, LayoutDashboard, Receipt, Users } from "lucide-react";
import type { NavRoute } from "@/shell/skin-contract";

/**
 * Banking nav — the source of truth for which segments are valid and the order
 * of the icon rail. Corrected from the pre-cutover draft (which labelled "" as
 * "Dashboard"): the app's INDEX route is the Credit Cards face view — today's
 * `/` served `page.tsx`, which renders the card faces under the heading "Credit
 * Cards" — while the dashboard lives at its own `dashboard` segment. Labels,
 * icons and order mirror the icon rail the banking layout has always rendered
 * (Dashboard, Charges, Credit Cards, Team Management).
 *
 * Segments: "" → credit cards (index), "dashboard" → dashboard,
 * "charges" → charges, "team" → team management. `resolvePage` additionally
 * accepts "cards" as an explicit alias of the index.
 */
export const bankingNav: NavRoute[] = [
  { segment: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { segment: "charges", label: "Charges", icon: Receipt },
  { segment: "", label: "Credit Cards", icon: CreditCard },
  { segment: "team", label: "Team Management", icon: Users },
];

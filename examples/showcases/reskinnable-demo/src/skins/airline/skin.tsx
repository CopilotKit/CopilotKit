"use client";

import type { ComponentType } from "react";
import type { Skin } from "@/shell/skin-contract";
import { airlineIdentity } from "./identity";
import { AirlineLayout } from "./layout";
import { AirlineTools } from "./tools";
import { airlineCatalog } from "./catalog";
import { airlineSuggestions } from "./suggestions";
import { AERONOVA_DESIGN_SKILL } from "./design-skill";
import { useAirlineData } from "./data/use-data";
import { TripsPage } from "./pages/trips";
import { LoyaltyPage } from "./pages/loyalty";
import { DisruptionsPage } from "./pages/disruptions";

// Route segments after /airline → page component. Empty → trips (index).
const PAGES: Record<string, ComponentType> = {
  "": TripsPage,
  loyalty: LoyaltyPage,
  disruptions: DisruptionsPage,
};

const airline: Skin = {
  id: "airline",
  identity: airlineIdentity,
  themeClass: "theme-airline",
  Layout: AirlineLayout,
  nav: [
    { segment: "", label: "Trip" },
    { segment: "loyalty", label: "Loyalty" },
    { segment: "disruptions", label: "Disruptions" },
  ],
  resolvePage: (segments) => {
    const key = segments.length === 0 ? "" : segments.join("/");
    return PAGES[key] ?? null;
  },
  Tools: AirlineTools,
  catalog: airlineCatalog,
  suggestions: airlineSuggestions,
  designSkill: AERONOVA_DESIGN_SKILL,
  // Human-readable activity-chip labels for the airline's own tools. This
  // app's contract carries `toolLabels`; the reference skin predates it, so
  // without this the chat would show raw tool names. Present-participle voice,
  // matching banking's own map.
  toolLabels: {
    showFlight: "Pulling up your flight",
    showLoyalty: "Checking your loyalty status",
    showRedemptions: "Browsing miles redemptions",
    showDisruption: "Checking for flight disruptions",
    trackBaggage: "Tracking your baggage",
    showBoardingPass: "Displaying your boarding pass",
    issueBoardingPass: "Issuing your boarding pass",
    selectSeat: "Selecting your seat",
    chooseRebooking: "Rebooking your flight",
  },
  useData: useAirlineData,
  // Providers and CanvasSurface intentionally omitted — the airline skin needs
  // no extra provider stack, and it has no a2ui report surface of its own.
  // OGUI surfaces still render full-region on the shared canvas: the shell owns
  // that region and detects the surface kind, so a skin supplies no OGUI
  // renderer either way.
};

export default airline;

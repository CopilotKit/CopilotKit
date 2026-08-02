import { createElement } from "react";

/**
 * Meridian — a fictional freight control tower. The agent triages shipment
 * exceptions and helps a planner decide: expedite, reroute, split, or absorb.
 * Palette is a warm signal-amber on graphite, deliberately distinct from
 * banking's violet and airline's teal.
 */
function MeridianLogo({ className }: { className?: string }) {
  // A compass rose / crosshair mark. `currentColor` so it inherits the brand
  // color wherever it mounts (nav, selector, chat header).
  return createElement(
    "svg",
    {
      className,
      viewBox: "0 0 24 24",
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg",
      "aria-hidden": true,
    },
    createElement("circle", {
      cx: 12,
      cy: 12,
      r: 9,
      stroke: "currentColor",
      strokeWidth: 1.8,
      opacity: 0.55,
    }),
    createElement("path", {
      d: "M12 4.5 14.6 12 12 19.5 9.4 12z",
      fill: "currentColor",
    }),
    createElement("path", {
      d: "M4.5 12h15",
      stroke: "currentColor",
      strokeWidth: 1.6,
      opacity: 0.45,
    }),
  );
}

export const logisticsIdentity = {
  brand: "Meridian",
  tagline: "Every exception, decided.",
  logo: MeridianLogo,
  favicon: "🧭",
  assistantName: "Meridian Control",
  greeting:
    "Rosa — Meridian Control here. Six lanes are live and three shipments need a call today. " +
    "I can triage the tower, weigh your options on a late shipment, or build a decision brief. Where do you want to start?",
} as const;

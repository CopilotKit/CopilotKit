import { createElement } from "react";

/**
 * The Myelin mark — three linked nodes, the middle one filled: a learning path
 * drawn as a signal travelling from step to step. Drawn in `currentColor` so it
 * picks up whatever colour it mounts into (and so the tenant rebrand recolours
 * it for free).
 */
function MyelinLogo({ className }: { className?: string }) {
  return createElement(
    "svg",
    {
      className,
      viewBox: "0 0 24 24",
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg",
      "aria-hidden": true,
    },
    createElement("path", {
      d: "M5 17.5 12 12l7-5.5",
      stroke: "currentColor",
      strokeWidth: 1.7,
      strokeLinecap: "round",
      strokeDasharray: "2.2 2.4",
    }),
    createElement("circle", {
      cx: 5,
      cy: 17.5,
      r: 2.4,
      stroke: "currentColor",
      strokeWidth: 1.7,
    }),
    createElement("circle", { cx: 12, cy: 12, r: 2.9, fill: "currentColor" }),
    createElement("circle", {
      cx: 19,
      cy: 6.5,
      r: 2.4,
      stroke: "currentColor",
      strokeWidth: 1.7,
    }),
  );
}

export const myelinIdentity = {
  brand: "Myelin",
  tagline: "Frontline learning journeys, built with an agent.",
  logo: MyelinLogo,
  favicon: "🧭",
  assistantName: "Myelin",
  greeting:
    "I'm Myelin. I can build and edit learning journeys with you, check who a change will affect before it goes live, and I remember how Harvest Lane likes things done. Pick a suggestion below to start.",
} as const;

import { createElement } from "react";

/**
 * Aeronova — a fictional passenger airline. The concierge helps travelers
 * check in, manage loyalty, and recover from disruptions. Its palette is a
 * deep-blue / teal aviation feel (distinct from banking's violet).
 */

function AeronovaLogo({ className }: { className?: string }) {
  // A stylized upward wing/paper-plane mark. `currentColor` so it inherits the
  // brand color wherever it is mounted (nav, selector, chat header).
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
      d: "M2.5 12.5 21 3.5 15 20l-4.2-6.2L4 12z",
      fill: "currentColor",
      opacity: 0.9,
    }),
    createElement("path", {
      d: "M10.8 13.8 21 3.5l-6.9 12.9-1.4-1.9z",
      fill: "currentColor",
      opacity: 0.55,
    }),
  );
}

export const airlineIdentity = {
  brand: "Aeronova",
  tagline: "Your journey, concierge-managed from gate to gate.",
  logo: AeronovaLogo,
  favicon: "✈️",
  assistantName: "Aeronova Concierge",
  greeting:
    "Hi Camila — I'm your Aeronova concierge. I can check you in and pick a seat, review your Aeronova Club status and rewards, or help if your flight is disrupted. What would you like to do?",
} as const;

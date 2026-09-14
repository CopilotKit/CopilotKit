import { createElement } from "react";

/**
 * The Vantage mark — a mountain peak: a lower back ridge for depth, a tall
 * front summit for the main silhouette, and a snow-cap notch at the tip.
 * Executive reporting is about surveying the whole landscape from the
 * highest point, so a summit says that in one shape.
 *
 * Everything is drawn in `currentColor` so the mark inherits whatever color
 * it mounts into — brand color in the nav rail, ink in the skin selector,
 * and the chat header's own foreground.
 */
function VantageLogo({ className }: { className?: string }) {
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
      d: "M2 19L8.5 8.5L14 19Z",
      fill: "currentColor",
      opacity: 0.45,
    }),
    createElement("path", {
      d: "M6 19L13 4.5L20 19Z",
      fill: "currentColor",
    }),
    createElement("path", {
      d: "M13 4.5L11.2 8L14.8 8Z",
      fill: "currentColor",
      opacity: 0.6,
    }),
  );
}

export const execIdentity = {
  brand: "Vantage",
  tagline: "Cascade Industries' executive reporting desk",
  logo: VantageLogo,
  favicon: "📊",
  assistantName: "Vantage",
  greeting: "Ask for any metric and pin what matters. What should we look at?",
} as const;

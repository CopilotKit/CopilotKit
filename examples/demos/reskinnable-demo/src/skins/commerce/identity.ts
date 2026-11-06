import { createElement } from "react";

/**
 * The Bellwether mark — a bell, with its clapper drawn as a separate dot that
 * sits just below the rim.
 *
 * A bellwether is the lead animal of a flock, the one carrying the bell that the
 * rest follow, and by extension the thing you watch to know where everything
 * else is going. That is exactly what this console is: a merchandiser's read on
 * where the range is heading. The clapper is offset rather than centred so the
 * mark reads as a bell mid-ring — a leading indicator in motion, not a static
 * notification icon.
 *
 * Everything is drawn in `currentColor` so the mark inherits whatever colour it
 * mounts into — ink blue in the nav rail, ink in the skin selector, and the chat
 * header's own foreground.
 */
function BellwetherLogo({ className }: { className?: string }) {
  return createElement(
    "svg",
    {
      className,
      viewBox: "0 0 24 24",
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg",
      "aria-hidden": true,
    },
    // The crown loop the bell hangs from.
    createElement("circle", {
      cx: 12,
      cy: 4.1,
      r: 1.7,
      stroke: "currentColor",
      strokeWidth: 1.6,
    }),
    // The body: a skirt that flares from the crown out to the rim.
    createElement("path", {
      d: "M5.6 17.2c0-6 2-9.4 6.4-9.4s6.4 3.4 6.4 9.4",
      stroke: "currentColor",
      strokeWidth: 1.7,
      strokeLinecap: "round",
    }),
    // The rim.
    createElement("path", {
      d: "M4.2 17.4h15.6",
      stroke: "currentColor",
      strokeWidth: 1.7,
      strokeLinecap: "round",
    }),
    // The clapper, swung off-centre.
    createElement("circle", {
      cx: 13.6,
      cy: 20.2,
      r: 1.5,
      fill: "currentColor",
    }),
  );
}

export const commerceIdentity = {
  brand: "Bellwether",
  tagline: "Storefront operations, from order to margin.",
  logo: BellwetherLogo,
  favicon: "🏷️",
  assistantName: "Bellwether",
  greeting:
    "I'm Bellwether. I can read whatever page you're on, work the exception queue, and move markdowns and returns through the desk. Pick a suggestion below to start.",
} as const;

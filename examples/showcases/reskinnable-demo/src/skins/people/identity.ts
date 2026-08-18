import { createElement } from "react";

/**
 * The Rowan mark — a rowan sprig: a stem carrying three pairs of leaflets under
 * a single berry. Chosen over the usual "three abstract humans" people-ops glyph
 * because the whole skin's visual thesis is growth over time (tenure, bands,
 * progression), and a sprig says that in one shape.
 *
 * Everything is drawn in `currentColor` so the mark inherits whatever color it
 * mounts into — brand plum in the nav rail, ink in the skin selector, and the
 * chat header's own foreground.
 */
function RowanLogo({ className }: { className?: string }) {
  const leaflet = (cx: number, cy: number, tilt: number, key: string) =>
    createElement("ellipse", {
      key,
      cx,
      cy,
      rx: 3.3,
      ry: 1.45,
      fill: "currentColor",
      opacity: 0.9,
      transform: `rotate(${tilt} ${cx} ${cy})`,
    });

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
      d: "M12 21.5V6.4",
      stroke: "currentColor",
      strokeWidth: 1.5,
      strokeLinecap: "round",
    }),
    createElement("circle", { cx: 12, cy: 3.6, r: 2.3, fill: "currentColor" }),
    leaflet(7.6, 9.4, -24, "l1"),
    leaflet(16.4, 9.4, 24, "r1"),
    leaflet(7.6, 13.6, -24, "l2"),
    leaflet(16.4, 13.6, 24, "r2"),
    leaflet(7.6, 17.8, -24, "l3"),
    leaflet(16.4, 17.8, 24, "r3"),
  );
}

export const peopleIdentity = {
  brand: "Rowan",
  tagline: "The people operations desk.",
  logo: RowanLogo,
  favicon: "🌿",
  assistantName: "Rowan",
  greeting:
    "I'm Rowan. I can read whatever page you're on, move people through comp and onboarding, and act on the queue. Pick a suggestion below to start.",
} as const;

import type { ComponentType } from "react";

/** Vantage's mark: an aperture opening onto a rising series — the vantage point. */
const VantageLogo: ComponentType<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M3 20h18" />
    <path d="M3 20 9 12l4 3 7-9" />
    <circle cx="20" cy="6" r="2" fill="currentColor" stroke="none" />
  </svg>
);

export const vantageIdentity = {
  brand: "Vantage",
  tagline: "Your numbers, read for you.",
  logo: VantageLogo,
  favicon: "📈",
  assistantName: "Vantage",
  greeting:
    "I read the numbers so you don't have to. Ask me how the quarter closed, or " +
    "tell me to build you a board.",
};

import type { ComponentType } from "react";

/**
 * The Keel hull-arc mark. Inline SVG so it inherits the theme via currentColor
 * and needs no asset pipeline.
 */
const KeelLogo: ComponentType<{ className?: string }> = ({ className }) => (
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
    <path d="M4 5v7a8 8 0 0 0 8 8 8 8 0 0 0 8-8V5" />
    <path d="M12 3v17" />
  </svg>
);

export const keelIdentity = {
  brand: "Keel",
  tagline: "Harbor Point Health — knowledge and operations desk",
  logo: KeelLogo,
  favicon: "⚓",
  assistantName: "Keel",
  greeting: "Ask me what the policy says — or hand me the work.",
};

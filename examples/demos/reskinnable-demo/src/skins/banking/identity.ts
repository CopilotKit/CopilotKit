import { createElement } from "react";

/**
 * Legacy flat identity — kept for banking-internal call sites (page metadata,
 * the layout brand line) that predate the Skin contract. The contract-shaped
 * `identity` below is the source of truth the shell reads via `skin.identity`.
 */
export const IDENTITY = {
  brand: "Northwind Finance",
  assistant: "Northwind Copilot",
  greeting:
    "Hi, I'm the Northwind Copilot. I can show your transactions, add cards, and assign expense policies. Try a suggestion or ask me anything.",
};

/**
 * Northwind's violet→indigo checkmark mark. `currentColor` where possible so it
 * inherits the brand color wherever it is mounted (nav, selector, chat header).
 */
function NorthwindLogo({ className }: { className?: string }) {
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
      d: "M4 13.5L9 7l4 4.5L20 4",
      stroke: "currentColor",
      strokeWidth: 2.2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }),
    createElement("circle", { cx: 20, cy: 4, r: 2, fill: "currentColor" }),
  );
}

/**
 * The Skin-contract identity for banking. `assistantName`/`greeting` mirror the
 * flat IDENTITY so the chat header + welcome copy are unchanged; `logo` and
 * `tagline` satisfy the contract's required fields (used by the shell's floating
 * skin selector and the banking layout's brand mark).
 */
export const identity = {
  brand: IDENTITY.brand,
  tagline: "Collaborative finance for 21st century teams",
  logo: NorthwindLogo,
  favicon: "🏦",
  assistantName: IDENTITY.assistant,
  greeting: IDENTITY.greeting,
} as const;

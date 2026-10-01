import { createElement } from "react";

/** The Ledgerline mark: two offset ledger bars, drawn inline. */
function LedgerlineLogo({ className }: { className?: string }) {
  return createElement(
    "svg",
    {
      className,
      viewBox: "0 0 24 24",
      xmlns: "http://www.w3.org/2000/svg",
      "aria-hidden": true,
    },
    createElement("rect", {
      x: 3,
      y: 5,
      width: 14,
      height: 4,
      rx: 2,
      fill: "hsl(184 72% 26%)",
    }),
    createElement("rect", {
      x: 7,
      y: 11,
      width: 14,
      height: 4,
      rx: 2,
      fill: "hsl(184 50% 45%)",
    }),
    createElement("rect", {
      x: 3,
      y: 17,
      width: 10,
      height: 2.5,
      rx: 1.25,
      fill: "hsl(38 92% 50%)",
    }),
  );
}

export const ledgerlineIdentity = {
  brand: "Ledgerline",
  tagline: "Expenses and approvals for Halcyon Labs",
  logo: LedgerlineLogo,
  favicon: "🧾",
  assistantName: "Ledgerline Assistant",
  greeting:
    "Hi Maya. I can find expense reports, approve them and schedule reimbursements.",
} as const;

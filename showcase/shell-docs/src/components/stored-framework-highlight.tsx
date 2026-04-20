"use client";

// StoredFrameworkHighlight — client-side marker rendered inside each
// framework card on the docs root pivot. When the card's slug matches
// the currently stored framework, we add a small "Your choice" badge
// and a subtle ring.
//
// This is intentionally additive: the server-rendered card carries all
// navigation + layout; this component only layers a "current selection"
// affordance on top without re-rendering the card shell on the client.

import React from "react";
import { useFramework } from "./framework-provider";

export function StoredFrameworkHighlight({ slug }: { slug: string }) {
  const { framework } = useFramework();
  if (framework !== slug) return null;
  return (
    <>
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-lg ring-2 ring-[var(--accent)] pointer-events-none"
      />
      <span className="ml-auto text-[9px] font-mono uppercase tracking-widest text-[var(--accent)]">
        Your choice
      </span>
    </>
  );
}

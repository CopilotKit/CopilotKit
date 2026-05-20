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
  // Read `storedFramework` (the REMEMBERED preference) rather than
  // `framework` (the strictly-URL-derived active framework). This
  // component is mounted inside the `/docs/*` pivot, where `framework`
  // is always null — keying off it would mean the badge never rendered.
  //
  // Covered by: visit /docs/ after previously picking LangChain → the
  // LangChain card shows the "Your choice" badge + accent ring.
  const { storedFramework } = useFramework();
  if (storedFramework !== slug) return null;
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

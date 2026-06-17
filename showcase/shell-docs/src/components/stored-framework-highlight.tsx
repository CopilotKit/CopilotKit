"use client";

// StoredFrameworkHighlight — client-side marker rendered inside each
// framework card on the docs root pivot. When the card's slug matches
// the currently stored framework, we add a subtle selected treatment.
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
  // Covered by: visit `/` after choosing a backend; that backend card
  // keeps a subtle accent treatment as the remembered selection.
  const { storedFramework } = useFramework();
  if (storedFramework !== slug) return null;
  return (
    <>
      <span
        aria-hidden="true"
        className="shell-docs-radius-surface pointer-events-none absolute inset-0 ring-1 ring-inset ring-[var(--nav-control-border)]"
      />
      <span className="sr-only">Current backend selection</span>
    </>
  );
}

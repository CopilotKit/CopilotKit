"use client";

import React from "react";
import Link from "next/link";
import { useFramework } from "./framework-provider";

export function IntegrationGrid({
  description,
}: {
  // `path` and `exclude` are authoring metadata passed by many MDX call
  // sites (which framework pages exist for this feature). They are not
  // rendered — the note links to the full backend list instead.
  path?: string;
  exclude?: string[];
  description?: string;
}) {
  const { framework } = useFramework();

  // On a framework-scoped route the user already chose a backend — hide.
  if (framework) return null;

  return (
    <>
      <h2>Choose your AI backend</h2>
      {description && (
        <p className="mb-4 text-[var(--text-secondary)]">{description}</p>
      )}
      <div className="shell-docs-radius-surface mb-4 bg-[var(--bg-elevated)] p-4 text-sm text-[var(--text-muted)]">
        See{" "}
        <Link href="/#backends" className="text-[var(--accent)]">
          all supported agent frameworks
        </Link>{" "}
        to pick your backend.
      </div>
    </>
  );
}

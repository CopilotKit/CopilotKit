"use client";

// SidebarLink — framework-aware client-side anchor used for every
// entry in the docs sidebar. Resolves its final href based on the
// active FrameworkContext:
//
//   - When the consumer passes `scope="docs"` (i.e. we're rendering
//     under `/docs/...`) and a framework is selected, rewrite the
//     href to `/<framework>/<slug>` so clicking keeps the user in
//     their chosen backend.
//   - When the consumer passes `scope="framework"` (we're rendering
//     under a framework-scoped page), always use the current
//     framework for the href. If no framework is active we fall back
//     to `/docs/<slug>`.
//
// The server renderer emits a best-guess default href via `fallbackHref`
// so the page works fine without JS; the client takes over on mount.

import React from "react";
import Link from "next/link";
import { useFramework } from "./framework-provider";

export interface SidebarLinkProps {
  slug: string;
  /** Rendered text. */
  children: React.ReactNode;
  /** Style class. */
  className?: string;
  /** Active-state data attribute. */
  active?: boolean;
  /**
   * The render context. `"docs"` = we're on `/docs/*`; `"framework"`
   * = we're on `/<framework>/*`. Affects which prefix we prefer.
   */
  scope: "docs" | "framework";
  /** Server-rendered fallback (used until the client hydrates). */
  fallbackHref: string;
}

export function SidebarLink({
  slug,
  children,
  className,
  active,
  scope,
  fallbackHref,
}: SidebarLinkProps) {
  const { framework } = useFramework();

  let href = fallbackHref;
  if (scope === "docs") {
    href = framework ? `/${framework}/${slug}` : `/docs/${slug}`;
  } else {
    // scope === "framework"
    href = framework ? `/${framework}/${slug}` : `/docs/${slug}`;
  }

  return (
    <Link
      href={href}
      data-active={active ? "true" : undefined}
      className={className}
    >
      {children}
    </Link>
  );
}

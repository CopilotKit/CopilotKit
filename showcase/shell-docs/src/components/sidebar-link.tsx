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
// `framework` is URL-derived (see framework-provider) so the resolved
// href is identical during SSR and post-hydration — no transient
// fallback path needed.

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
  /**
   * Deprecated. Previously held a server-rendered best-guess href used
   * before hydration; the component now resolves the href identically
   * during SSR and on the client, so this value is ignored. Kept on the
   * interface for call-site compatibility.
   */
  fallbackHref?: string;
}

export function SidebarLink({
  slug,
  children,
  className,
  active,
  scope: _scope,
  fallbackHref: _fallbackHref,
}: SidebarLinkProps) {
  const { framework } = useFramework();

  // Both scopes currently resolve the same way: use the active
  // framework when set, otherwise fall through to /docs/<slug>. We
  // keep `scope` in the props for call-site clarity and future
  // divergence without any runtime branching.
  const href = framework ? `/${framework}/${slug}` : `/docs/${slug}`;

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

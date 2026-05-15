"use client";

// SidebarLink — framework-aware client-side anchor used for every entry
// in the docs sidebar. Resolves its final href against
// `effectiveFramework`, which falls through URL → stored → default
// (Built-in Agent), so every sidebar click lands on a real
// `/<framework>/<slug>` URL.

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
   * = we're on `/<framework>/*`. Currently unused by the resolver (see
   * note below) — kept optional on the interface for call-site clarity.
   */
  scope?: "docs" | "framework";
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
  const { effectiveFramework } = useFramework();
  const href = `/${effectiveFramework}/${slug}`;

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

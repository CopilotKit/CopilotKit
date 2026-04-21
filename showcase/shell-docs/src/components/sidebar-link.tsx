"use client";

// SidebarLink — framework-aware client-side anchor used for every
// entry in the docs sidebar. Resolves its final href based on the
// active FrameworkContext: when a framework is selected, the href is
// `/<framework>/<slug>`; otherwise it falls through to `/<slug>`.
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
}

export function SidebarLink({
  slug,
  children,
  className,
  active,
}: SidebarLinkProps) {
  const { framework } = useFramework();

  // Use the active framework when set, otherwise fall through to
  // /<slug>.
  const href = framework ? `/${framework}/${slug}` : `/${slug}`;

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

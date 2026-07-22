"use client";

import posthog from "posthog-js";
import { useCallback } from "react";

export interface DocsTrackedLinkProps {
  href: string;
  surface: string;
  children: React.ReactNode;
  className?: string;
  target?: string;
  rel?: string;
}

export function DocsTrackedLink({
  href,
  surface,
  children,
  className,
  target,
  rel,
}: DocsTrackedLinkProps) {
  const handleClick = useCallback(() => {
    try {
      posthog.capture("docs_conversion_clicked", {
        surface,
        destination: href,
      });
    } catch {
      // Analytics must never block navigation.
    }
  }, [href, surface]);

  return (
    <a
      href={href}
      className={className}
      target={target}
      rel={rel}
      onClick={handleClick}
      data-docs-conversion-surface={surface}
    >
      {children}
    </a>
  );
}

export function DocsTrackedCopy({
  surface,
  children,
}: {
  surface: string;
  children: React.ReactNode;
}) {
  return <div data-docs-copy-surface={surface}>{children}</div>;
}

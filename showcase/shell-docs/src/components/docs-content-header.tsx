import type React from "react";
import { Fragment } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { DocsDescription, DocsTitle } from "fumadocs-ui/page";

export type DocsContentHeaderBreadcrumb = {
  label: string;
  href: string | null;
};

export interface DocsContentHeaderProps {
  /** Ancestors only; the current page is represented by the title below. */
  ancestorBreadcrumbs: DocsContentHeaderBreadcrumb[];
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Keep breadcrumb/actions chrome while an MDX-owned hero replaces the H1. */
  hideHeading?: boolean;
  /** Page-level actions composed into the title row. */
  children?: React.ReactNode;
}

/**
 * Shared visual header for guide and reference content pages.
 *
 * Routes keep ownership of breadcrumb construction and page actions because
 * their URL/content rules differ. This component owns only the common
 * hierarchy, alignment, typography, and responsive wrapping behavior.
 */
export function DocsContentHeader({
  ancestorBreadcrumbs,
  title,
  description,
  hideHeading = false,
  children,
}: DocsContentHeaderProps): React.JSX.Element {
  return (
    <header className="docs-page-header">
      {ancestorBreadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="docs-page-breadcrumb">
          {ancestorBreadcrumbs.map((crumb, index) => (
            <Fragment
              key={`${crumb.label}-${crumb.href ?? "current"}-${index}`}
            >
              {index > 0 && (
                <ChevronRight
                  className="size-3 shrink-0"
                  aria-hidden="true"
                />
              )}
              {crumb.href ? (
                <Link href={crumb.href}>{crumb.label}</Link>
              ) : (
                <span>{crumb.label}</span>
              )}
            </Fragment>
          ))}
        </nav>
      )}

      {(!hideHeading || children) && (
        <div className="docs-page-heading-row">
          {!hideHeading && (
            <DocsTitle className="docs-page-title">{title}</DocsTitle>
          )}
          {children}
        </div>
      )}

      {!hideHeading && description && (
        <DocsDescription className="docs-page-description">
          {description}
        </DocsDescription>
      )}
    </header>
  );
}

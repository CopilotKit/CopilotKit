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
  /** Page-level actions shown after the page introduction. */
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
}: DocsContentHeaderProps): React.JSX.Element | null {
  // Every part of this header is individually suppressible, and a landing page
  // suppresses all of them: `hideBreadcrumb` empties the crumbs, `hideHeader`
  // drops the title and description, `hidePageActions` drops the actions. What
  // was left was an empty `<header>` still carrying `.docs-page-header`'s
  // 2.75rem bottom margin, so the authored-MDX partner pages started ~44px
  // lower than the data-record ones that never render this component at all.
  const hasBreadcrumbs = ancestorBreadcrumbs.length > 0;
  const hasHeading = !hideHeading;
  const hasActions = Boolean(children);
  if (!hasBreadcrumbs && !hasHeading && !hasActions) return null;

  return (
    <header className="docs-page-header">
      {ancestorBreadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="docs-page-breadcrumb">
          {ancestorBreadcrumbs.map((crumb, index) => (
            <Fragment
              key={`${crumb.label}-${crumb.href ?? "current"}-${index}`}
            >
              {index > 0 && (
                <ChevronRight className="size-3 shrink-0" aria-hidden="true" />
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

      {!hideHeading && (
        <div className="docs-page-heading-row">
          <DocsTitle className="docs-page-title">{title}</DocsTitle>
        </div>
      )}

      {!hideHeading && description && (
        <DocsDescription className="docs-page-description">
          {description}
        </DocsDescription>
      )}

      {children && <div className="docs-page-actions-row">{children}</div>}
    </header>
  );
}

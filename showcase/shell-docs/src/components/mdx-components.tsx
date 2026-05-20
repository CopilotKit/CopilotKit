import React from "react";
import Link from "next/link";

// `Callout` is owned by `docs-callout.tsx` (broader type surface: info |
// tip | warn | warning | error | danger | note). Re-exported here so
// historical imports from `@/components/mdx-components` keep working.
export { Callout } from "@/components/docs-callout";

export function Cards({
  children,
  className: _className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  // `not-prose` opts the wrapped Cards out of the .reference-content
  // prose-link styling (which forces underline + accent color on every
  // <a>). The Card's own className already controls link appearance.
  return (
    <div className="not-prose grid grid-cols-1 sm:grid-cols-2 gap-4 my-6">
      {children}
    </div>
  );
}

export function Card({
  title,
  description,
  href,
  icon,
  className,
  children,
}: {
  title: string;
  description?: string;
  href?: string;
  icon?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  // Match the docs-landing pointer-card style:
  // - bordered surface, accent border on hover, subtle shadow on hover
  // - title flips to accent color on hover via `group-hover` so the link
  //   feels active without using a default underline
  // - `not-prose` is the load-bearing class: the article body uses
  //   `.reference-content` which forces `text-decoration: underline;
  //   color: var(--accent)` on every <a>; that rule wins over the
  //   Tailwind `no-underline` class on specificity. `not-prose`
  //   triggers the global escape-hatch rule that drops both.
  const mergedClassName = [
    "block group rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4",
    href
      ? "not-prose no-underline hover:border-[var(--accent)] hover:shadow-sm transition"
      : "transition-colors",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      {icon && (
        <div className="mb-2 text-[var(--text-muted)]" aria-hidden>
          {icon}
        </div>
      )}
      <div
        className={`font-semibold text-[var(--text)] text-sm${
          href ? " group-hover:text-[var(--accent)]" : ""
        }`}
      >
        {title}
      </div>
      {description && (
        <div className="text-xs text-[var(--text-muted)] mt-1">
          {description}
        </div>
      )}
      {children && (
        <div className="text-xs text-[var(--text-secondary)] mt-2">
          {children}
        </div>
      )}
    </>
  );

  if (href) {
    // Rewrite /reference/v2/... paths to /reference/...
    const resolvedHref = href.replace(/^\/reference\/v2\//, "/reference/");
    // Inline `textDecoration: none` is the load-bearing override here.
    // The escape-hatch CSS rule `.reference-content .not-prose a {
    // text-decoration: none }` only fires when `not-prose` sits on a
    // *parent* of the <a> (descendant selector). Standalone Cards
    // outside of a <Cards> wrapper have nothing above them to carry
    // that class, so the prose-default underline still leaks through.
    // The inline style wins on specificity in every shape.
    return (
      <Link
        href={resolvedHref}
        className={mergedClassName}
        style={{ textDecoration: "none", color: "inherit" }}
      >
        {content}
      </Link>
    );
  }

  return <div className={mergedClassName}>{content}</div>;
}

export function Accordions({ children }: { children: React.ReactNode }) {
  return <div className="my-4 space-y-2">{children}</div>;
}

export function Accordion({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--text)] select-none hover:bg-[var(--bg-elevated)] transition-colors">
        {title}
      </summary>
      <div className="px-4 pb-4 text-sm text-[var(--text-secondary)]">
        {children}
      </div>
    </details>
  );
}

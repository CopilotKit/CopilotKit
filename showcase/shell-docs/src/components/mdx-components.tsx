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
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-6">{children}</div>
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
  // Render `icon`, `className`, and `children` instead of silently
  // dropping them — matches MDX author expectations (Mintlify-style
  // Cards accept all three).
  const mergedClassName = [
    "rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 hover:bg-[var(--bg-elevated)] transition-colors",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <div className={mergedClassName}>
      {icon && (
        <div className="mb-2 text-[var(--text-muted)]" aria-hidden>
          {icon}
        </div>
      )}
      <div className="font-semibold text-[var(--text)] text-sm">{title}</div>
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
    </div>
  );

  if (href) {
    // Rewrite /reference/v2/... paths to /reference/...
    const resolvedHref = href.replace(/^\/reference\/v2\//, "/reference/");
    return <Link href={resolvedHref}>{content}</Link>;
  }

  return content;
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

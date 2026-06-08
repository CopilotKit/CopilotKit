import type React from "react";
import {
  Card as FumadocsCard,
  Cards as FumadocsCards,
} from "fumadocs-ui/components/card";

// Re-export fumadocs's default `<Callout>` so historical imports from
// `@/components/mdx-components` keep working. Fumadocs supports the
// types `info | warn | warning | error | success | idea`, plus the
// alias `tip` (resolves to info). Other custom types fall back to the
// default tone.
export { Callout } from "fumadocs-ui/components/callout";

export function Cards({
  className,
  ...props
}: React.ComponentProps<typeof FumadocsCards>) {
  // `not-prose` opts the wrapped Cards out of the .reference-content
  // prose-link styling (which forces underline + accent color on every
  // <a>). The Card's own className already controls link appearance.
  return (
    <FumadocsCards
      {...props}
      className={["not-prose my-6 grid-cols-1 gap-4 sm:grid-cols-2", className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

export function Card({
  href,
  className,
  style,
  ...props
}: React.ComponentProps<typeof FumadocsCard>) {
  // Match the docs-landing pointer-card style:
  // - bordered surface, accent border on hover, subtle shadow on hover
  // - title flips to accent color on hover via `group-hover` so the link
  //   feels active without using a default underline
  // - `not-prose` is the load-bearing class: the article body uses
  //   `.reference-content` which forces `text-decoration: underline;
  //   color: var(--accent)` on every <a>; that rule wins over the
  //   Tailwind `no-underline` class on specificity. `not-prose`
  //   triggers the global escape-hatch rule that drops both.
  const resolvedHref = href?.replace(/^\/reference\/v2\//, "/reference/");
  const mergedClassName = [
    "shell-docs-radius-surface border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text)] shadow-[var(--shadow-control)]",
    href
      ? "not-prose hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)]"
      : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <FumadocsCard
      {...props}
      href={resolvedHref}
      className={mergedClassName}
      style={
        href ? { textDecoration: "none", color: "inherit", ...style } : style
      }
    />
  );
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
    <details className="shell-docs-radius-surface group border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-control)]">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-[var(--text)] transition-colors hover:bg-[var(--bg-elevated)]">
        {title}
      </summary>
      <div className="px-4 pb-4 text-sm text-[var(--text-secondary)]">
        {children}
      </div>
    </details>
  );
}

import type React from "react";
import Image from "next/image";
import {
  Card as FumadocsCard,
  Cards as FumadocsCards,
} from "fumadocs-ui/components/card";
import { ChevronDown, Copy, SquareTerminal } from "lucide-react";

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

type DocsCardProps = React.ComponentProps<typeof FumadocsCard> & {
  logo?: string;
  logoAlt?: string;
  logoClassName?: string;
};

export function Card({
  href,
  className,
  style,
  icon,
  logo,
  logoAlt = "",
  logoClassName,
  ...props
}: DocsCardProps) {
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
  const resolvedIcon =
    icon ??
    (logo ? (
      <Image
        src={logo}
        alt={logoAlt}
        width={20}
        height={20}
        className={["h-5 w-5 shrink-0 object-contain", logoClassName]
          .filter(Boolean)
          .join(" ")}
        unoptimized
      />
    ) : undefined);
  const mergedClassName = [
    "shell-docs-radius-surface border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text)] shadow-[var(--shadow-control)]",
    "[&_h3]:!mt-0 [&_h3]:!mb-1.5 [&_h3]:!text-base [&_h3]:!font-semibold [&_h3]:!leading-snug [&_p]:!text-sm [&_p]:!leading-relaxed",
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
      icon={resolvedIcon}
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
  description,
  featured = false,
  children,
}: {
  title: string;
  description?: string;
  featured?: boolean;
  children: React.ReactNode;
}) {
  if (featured) {
    return (
      // Deliberately token-only, matching the in-content panel idiom in
      // `OpsPlatformCTA`: neutral surface, `--border`, `--shadow-control`, and
      // accent carried by a small glyph and the action, never by a filled block
      // or a tinted gradient. `copilotkit-ui-theme` flags a purple accent bar
      // or stripe as a known wrong direction, and `copilotkit-branding` scopes
      // accent to restrained and atmospheric use — a saturated `--accent` tile
      // plus an accent-mixed gradient was both at once. Padding is `p-4`, the
      // same as every other docs panel, so a collapsed prompt no longer pushes
      // the page's own introduction below the fold.
      <details className="shell-docs-radius-surface not-prose group my-6 overflow-hidden border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-control)]">
        <summary className="cursor-pointer list-none p-4 select-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          <span className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <span className="flex min-w-0 flex-1 items-start gap-3">
              <SquareTerminal
                aria-hidden="true"
                className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]"
              />

              <span className="min-w-0">
                <span className="block font-semibold text-[var(--text)]">
                  {title}
                </span>
                {description ? (
                  <span className="mt-1 block max-w-[62ch] text-sm leading-relaxed text-[var(--text-muted)]">
                    {description}
                  </span>
                ) : null}
              </span>
            </span>

            <span className="shell-docs-radius-control inline-flex min-h-9 w-full shrink-0 items-center justify-center gap-1.5 border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-sm font-medium text-[var(--text)] shadow-[var(--shadow-control)] transition-colors group-hover:border-[var(--accent)] group-hover:text-[var(--accent)] sm:w-auto">
              <Copy aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="group-open:hidden">Open &amp; copy prompt</span>
              <span className="hidden group-open:inline">Close prompt</span>
              <ChevronDown
                aria-hidden="true"
                className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180"
              />
            </span>
          </span>
        </summary>
        <div className="border-t border-[var(--border)] bg-[var(--bg-surface)] px-4 pt-3 pb-4 text-sm text-[var(--text-secondary)] [&>p:first-child]:mt-0">
          {children}
        </div>
      </details>
    );
  }

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

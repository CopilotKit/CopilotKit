import type React from "react";
import Image from "next/image";
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
  //   color: var(--brand-accent)` on every <a>; that rule wins over the
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
    "shell-docs-module-card shell-docs-radius-surface border text-[var(--foreground)]",
    "[&_h3]:!mt-0 [&_h3]:!mb-1.5 [&_h3]:!text-base [&_h3]:!font-semibold [&_h3]:!leading-snug [&_p]:!text-sm [&_p]:!leading-relaxed",
    href ? "not-prose" : null,
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
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="shell-docs-module-card shell-docs-radius-surface group border">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)]">
        {title}
      </summary>
      <div className="px-4 pb-4 text-sm text-[var(--muted-foreground)]">
        {children}
      </div>
    </details>
  );
}

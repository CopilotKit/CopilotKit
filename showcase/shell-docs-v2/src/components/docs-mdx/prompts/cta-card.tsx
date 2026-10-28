import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { cn } from "@/lib/cn";

// The look shared by the docs' Intelligence CTAs (OpsPlatformCTA,
// QuickstartIntelligenceCta): a white card with a hairline edge that takes
// the lilac action edge on hover, CopilotKit's kite in its own colors as the
// stamp, and one action. Server-safe: callers wrap it in their own link.

export type CtaSize = "inline" | "card" | "tile";

/** Classes for the link that holds a CTA card. */
export function ctaCardClass(size: CtaSize, className?: string) {
  return cn(
    "not-prose group flex rounded-xl border bg-card text-foreground no-underline transition-colors duration-150 hover:border-edge-action focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none",
    size === "card"
      ? "my-8 flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-6"
      : size === "inline"
        ? "my-6 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
        : "my-6 items-start gap-3 p-4",
    className,
  );
}

/** The kite, the title and the body, then the action label (if any). */
export function CtaCardBody({
  size,
  title,
  body,
  label,
}: {
  size: CtaSize;
  title: ReactNode;
  body?: ReactNode;
  label?: ReactNode;
}) {
  const large = size === "card";
  return (
    <>
      <span className="flex min-w-0 items-start gap-3">
        <span aria-hidden className="mt-0.5 flex shrink-0">
          <FrameworkLogo slug="built-in-agent" size={large ? 22 : 18} />
        </span>
        <span className="min-w-0">
          <span
            className={cn(
              "block font-semibold",
              large ? "text-lg leading-tight tracking-[-0.01em]" : "leading-snug",
            )}
          >
            {title}
          </span>
          {body ? (
            <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
              {body}
            </span>
          ) : null}
        </span>
      </span>
      {label ? (
        large ? (
          // The card's one primary action: the plum pill.
          <span className="inline-flex h-11 shrink-0 items-center gap-2 self-start rounded-full bg-foreground px-5 text-sm font-medium whitespace-nowrap text-background transition-colors group-hover:bg-foreground/85 sm:self-auto">
            {label}
            <ArrowRight
              className="size-4 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none"
              aria-hidden
            />
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold whitespace-nowrap text-primary">
            {label}
            <ArrowRight
              className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none"
              aria-hidden
            />
          </span>
        )
      ) : null}
    </>
  );
}

"use client";
import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Two initials from a name ("Nathan Brooks" -> "NB"). */
export function initials(name?: string): string {
  if (!name) return "?";
  return (
    name
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

/**
 * Dashboard section card: the shadcn Card with a title row and the F2 hover-lift
 * (cards already carry --shadow-card; we add the translate/shadow on hover).
 * `action` renders to the right of the title (e.g. a "View all" link).
 */
export function SectionCard({
  title,
  action,
  className,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      className={cn(
        "gap-4 p-4 transition hover:-translate-y-0.5 hover:shadow-md",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

/**
 * Avatar that loads a remote photo via a plain <img> (per the design's "no
 * next/image for Unsplash" rule) and falls back to colored initials if the
 * image is missing or errors. Sizes are square; `size` is the px edge.
 */
export function OwnerAvatar({
  src,
  name,
  size = 28,
  className,
}: {
  src?: string;
  name?: string;
  size?: number;
  className?: string;
}) {
  const [errored, setErrored] = React.useState(false);
  const showImg = !!src && !errored;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-[10px] font-medium text-muted-foreground",
        className,
      )}
      style={{ width: size, height: size }}
      title={name}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name ?? ""}
          loading="lazy"
          width={size}
          height={size}
          onError={() => setErrored(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}

/**
 * Square product thumbnail via a plain <img> with a graceful fallback to a
 * subtle placeholder tile when the photo is missing or errors.
 */
export function ProductThumb({
  src,
  alt,
  size = 36,
  className,
}: {
  src?: string;
  alt?: string;
  size?: number;
  className?: string;
}) {
  const [errored, setErrored] = React.useState(false);
  const showImg = !!src && !errored;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-secondary",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt ?? ""}
          loading="lazy"
          width={size}
          height={size}
          onError={() => setErrored(true)}
          className="h-full w-full object-cover"
        />
      ) : null}
    </span>
  );
}

/** Small colored risk dot (low/medium/high) driven by the --risk-* tokens. */
export function RiskDot({
  risk,
  className,
}: {
  risk: "low" | "medium" | "high";
  className?: string;
}) {
  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: `var(--risk-${risk})` }}
      title={`Risk: ${risk}`}
    />
  );
}

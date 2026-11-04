"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Admin } from "../data/types";

/** A clock that re-renders every `ms`, for "fresh" glows and relative times. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function Pill({
  tone = "muted",
  children,
  className,
}: {
  tone?: "muted" | "brand" | "accent" | "positive" | "negative";
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[0.68rem] font-semibold",
        tone === "muted" && "bg-surface-muted text-ink-muted",
        tone === "brand" && "bg-brand-soft text-brand",
        tone === "accent" && "bg-brand-violet/12 text-brand-violet",
        tone === "positive" && "bg-positive-soft text-positive",
        tone === "negative" && "bg-negative-soft text-negative",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Avatar({
  admin,
  size = "md",
  ring = false,
}: {
  admin: Admin;
  size?: "sm" | "md";
  ring?: boolean;
}) {
  return (
    <span
      title={admin.name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        size === "sm" ? "h-6 w-6 text-[0.6rem]" : "h-8 w-8 text-[0.7rem]",
        ring && "ring-2 ring-surface",
      )}
      style={{ background: admin.color }}
    >
      {admin.initials}
    </span>
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-hairline bg-surface p-5 shadow-soft",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[0.68rem] font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </div>
      <div className="my-num mt-0.5 text-lg font-semibold text-ink">
        {value}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>
        ) : null}
      </div>
      {right}
    </div>
  );
}

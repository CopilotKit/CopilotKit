"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ReportStatus } from "../data/types";

export const primaryButton =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand-indigo disabled:cursor-not-allowed disabled:opacity-45";

export const secondaryButton =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-hairline bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-45";

const STATUS: Record<ReportStatus, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "bg-surface-muted text-ink-muted" },
  submitted: {
    label: "Awaiting approval",
    tone: "bg-[hsl(38_100%_95%)] text-[hsl(30_80%_30%)]",
  },
  approved: { label: "Approved", tone: "bg-brand-soft text-brand" },
  reimbursed: { label: "Reimbursed", tone: "bg-positive-soft text-positive" },
  rejected: { label: "Rejected", tone: "bg-negative-soft text-negative" },
};

export function StatusPill({ status }: { status: ReportStatus }) {
  const s = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[0.7rem] font-semibold",
        s.tone,
      )}
    >
      {s.label}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[1.45rem] font-semibold tracking-[-0.02em] text-ink">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "brand" | "warn";
}) {
  return (
    <div className="rounded-xl border border-hairline bg-surface px-4 py-3">
      <div className="text-[0.7rem] font-medium uppercase tracking-[0.06em] text-ink-muted">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums tracking-tight",
          tone === "brand" && "text-brand",
          tone === "warn" && "text-[hsl(30_80%_34%)]",
        )}
      >
        {value}
      </div>
    </div>
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
      className={cn("rounded-xl border border-hairline bg-surface", className)}
    >
      {children}
    </section>
  );
}

const AVATAR_TONES = [
  "bg-[hsl(184_45%_88%)] text-[hsl(184_72%_22%)]",
  "bg-[hsl(38_90%_88%)] text-[hsl(30_80%_28%)]",
  "bg-[hsl(220_60%_90%)] text-[hsl(222_55%_32%)]",
  "bg-[hsl(330_50%_91%)] text-[hsl(330_50%_32%)]",
  "bg-[hsl(150_40%_88%)] text-[hsl(152_55%_24%)]",
  "bg-[hsl(265_45%_91%)] text-[hsl(265_40%_36%)]",
];

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function Avatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md";
}) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        size === "sm" ? "h-6 w-6 text-[0.6rem]" : "h-8 w-8 text-[0.7rem]",
        AVATAR_TONES[h % AVATAR_TONES.length],
      )}
    >
      {initials(name)}
    </span>
  );
}

export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "brand" | "warn" | "negative" | "positive";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[0.68rem] font-semibold",
        tone === "muted" && "bg-surface-muted text-ink-muted",
        tone === "brand" && "bg-brand-soft text-brand",
        tone === "warn" && "bg-[hsl(38_100%_95%)] text-[hsl(30_80%_30%)]",
        tone === "negative" && "bg-negative-soft text-negative",
        tone === "positive" && "bg-positive-soft text-positive",
      )}
    >
      {children}
    </span>
  );
}

export function CardHeader({
  title,
  action,
}: {
  title: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-2.5">
      <h2 className="text-[0.86rem] font-semibold">{title}</h2>
      {action}
    </div>
  );
}

/** Horizontal bars, label left, value right. */
export function BarList({
  rows,
  format,
}: {
  rows: { label: string; value: number; hint?: string }[];
  format: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between text-[0.78rem]">
            <span className="font-medium">{r.label}</span>
            <span className="tabular-nums text-ink-muted">
              {format(r.value)}
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-surface-muted">
            <div
              className="h-1.5 rounded-full bg-brand"
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A small column chart of weekly values. */
export function Columns({
  values,
  labels,
  format,
}: {
  values: number[];
  labels: string[];
  format: (n: number) => string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-36 items-end gap-2">
      {values.map((v, i) => (
        <div
          key={labels[i]}
          className="flex flex-1 flex-col items-center gap-1.5"
        >
          <span className="text-[0.62rem] tabular-nums text-ink-muted">
            {format(v)}
          </span>
          <div
            className={cn(
              "w-full rounded-t-md",
              i === values.length - 1 ? "bg-brand" : "bg-[hsl(184_40%_80%)]",
            )}
            style={{ height: `${Math.max(4, (v / max) * 96)}px` }}
          />
          <span className="text-[0.62rem] text-ink-muted">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

/** A budget meter: spent of budget, amber over 80%, red over 100%. */
export function Meter({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? value / max : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-surface-muted">
      <div
        className={cn(
          "h-1.5 rounded-full",
          pct > 1
            ? "bg-negative"
            : pct > 0.8
              ? "bg-[hsl(38_92%_50%)]"
              : "bg-brand",
        )}
        style={{ width: `${Math.min(100, Math.max(2, pct * 100))}%` }}
      />
    </div>
  );
}

"use client";

/**
 * Ledgerline's primitives, "crisp ledger": white panels on hairlines, ink
 * primary buttons, square-ish 6px chips, tabular money with a lighter
 * currency symbol. Shared by the pages, the chat cards and the MCP app, so
 * nothing here may import Next or CopilotKit.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ReportStatus } from "../data/types";

export const primaryButton =
  "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-brand px-3 text-[13px] font-medium text-white shadow-[inset_0_-1px_0_hsl(227_82%_40%)] transition-colors hover:bg-brand-indigo active:translate-y-px disabled:cursor-not-allowed disabled:bg-[hsl(var(--ll-gray-soft))] disabled:text-[hsl(var(--ll-faint))]";

export const secondaryButton =
  "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-hairline bg-surface px-3 text-[13px] font-medium text-ink transition-colors hover:bg-surface-muted active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45";

export const ghostButton =
  "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13px] font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-45";

const STATUS: Record<ReportStatus, { label: string; tone: ChipTone }> = {
  draft: { label: "Draft", tone: "gray" },
  submitted: { label: "Awaiting approval", tone: "amber" },
  approved: { label: "Approved", tone: "blue" },
  reimbursed: { label: "Reimbursed", tone: "green" },
  rejected: { label: "Returned", tone: "gray" },
};

type ChipTone = "gray" | "amber" | "blue" | "green" | "red";

const CHIP: Record<ChipTone, string> = {
  gray: "bg-[hsl(var(--ll-gray-soft))] text-ink-muted",
  amber: "bg-[hsl(var(--ll-amber-soft))] text-[hsl(var(--ll-amber))]",
  blue: "bg-brand-soft text-brand-indigo",
  green: "bg-positive-soft text-positive",
  red: "bg-negative-soft text-negative",
};

export function Chip({
  children,
  tone = "gray",
  className,
}: {
  children: ReactNode;
  tone?: ChipTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-[5px] px-1.5 text-[11.5px] font-medium",
        CHIP[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: ReportStatus }) {
  const s = STATUS[status];
  return <Chip tone={s.tone}>{s.label}</Chip>;
}

/** Back-compat name for the chat cards. */
export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "brand" | "warn" | "negative" | "positive";
}) {
  const map: Record<string, ChipTone> = {
    muted: "gray",
    brand: "blue",
    warn: "amber",
    negative: "red",
    positive: "green",
  };
  return <Chip tone={map[tone]}>{children}</Chip>;
}

/** Money: tabular figures, the currency symbol lighter than the value. */
export function Money({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const abs = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    <span className={cn("ll-num whitespace-nowrap", className)}>
      {value < 0 ? "-" : ""}
      <span className="ll-cur">$</span>
      {abs}
    </span>
  );
}

export function Id({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("ll-mono text-[hsl(var(--ll-faint))]", className)}>
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">
          {title}
        </h1>
        {subtitle ? (
          <div className="mt-1 text-[13px] text-ink-muted">{subtitle}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

/** One figure in a KPI strip: no card, a hairline between neighbours. */
export function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: "brand" | "warn" | "red";
  hint?: ReactNode;
}) {
  return (
    <div className="min-w-0 bg-canvas px-4 py-4">
      <div className="text-[12px] text-ink-muted">{label}</div>
      <div
        className={cn(
          "ll-num mt-1.5 text-[24px] font-semibold leading-none tracking-[-0.025em]",
          tone === "brand" && "text-brand",
          tone === "warn" && "text-[hsl(var(--ll-amber))]",
          tone === "red" && "text-negative",
        )}
      >
        {value}
      </div>
      {hint ? (
        <div className="mt-1.5 text-[12px] text-[hsl(var(--ll-faint))]">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function StatStrip({ children }: { children: ReactNode }) {
  return (
    <div className="mb-7 grid grid-cols-2 gap-px border-y border-hairline bg-hairline @[620px]:grid-cols-4">
      {children}
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
      className={cn(
        "rounded-[10px] border border-hairline bg-surface",
        className,
      )}
    >
      {children}
    </section>
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
    <div className="flex h-11 items-center justify-between gap-2 border-b border-hairline px-4">
      <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
      {action}
    </div>
  );
}

const AVATAR_TONES = [
  "bg-[hsl(220_14%_92%)] text-[hsl(222_14%_30%)]",
  "bg-[hsl(228_60%_94%)] text-[hsl(227_60%_38%)]",
  "bg-[hsl(150_25%_91%)] text-[hsl(154_40%_25%)]",
  "bg-[hsl(32_50%_92%)] text-[hsl(30_55%_30%)]",
  "bg-[hsl(280_20%_93%)] text-[hsl(280_25%_35%)]",
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
        size === "sm" ? "h-5 w-5 text-[9px]" : "h-7 w-7 text-[10.5px]",
        AVATAR_TONES[h % AVATAR_TONES.length],
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Horizontal bars, label left, value right. */
export function BarList({
  rows,
  format,
}: {
  rows: { label: string; value: number; color?: string }[];
  format: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li
          key={r.label}
          className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5"
        >
          <span className="text-[13px]">{r.label}</span>
          <span className="ll-num text-[13px] text-ink-muted">
            {format(r.value)}
          </span>
          <div className="col-span-2 h-1.5 rounded-full bg-surface-muted">
            <div
              className="h-1.5 rounded-full"
              style={{
                width: `${Math.max(2, (r.value / max) * 100)}%`,
                background: r.color ?? "hsl(var(--brand))",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A column chart of weekly values; the current week in the accent. */
export function Columns({
  values,
  labels,
  format,
  tone = "brand",
  height = 104,
}: {
  values: number[];
  labels: string[];
  format: (n: number) => string;
  tone?: "brand" | "red";
  height?: number;
}) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-3" style={{ height: height + 56 }}>
      {values.map((v, i) => (
        <div
          key={labels[i]}
          className="flex flex-1 flex-col items-center gap-1.5"
        >
          <span className="ll-num text-[11px] text-ink-muted">{format(v)}</span>
          <div
            className={cn(
              "w-full rounded-[3px]",
              i === values.length - 1
                ? "bg-brand"
                : tone === "red"
                  ? "bg-[hsl(6_70%_80%)]"
                  : "bg-[hsl(227_90%_85%)]",
              i === values.length - 1 && tone === "red" && "bg-negative",
            )}
            style={{ height: `${Math.max(3, (v / max) * height)}px` }}
          />
          <span className="text-[11px] text-[hsl(var(--ll-faint))]">
            {labels[i]}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A budget meter: ink until 80%, amber past it, red past the budget. */
export function Meter({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? value / max : 0;
  return (
    <div className="h-1 w-full rounded-full bg-surface-muted">
      <div
        className={cn(
          "h-1 rounded-full",
          pct > 1
            ? "bg-negative"
            : pct > 0.8
              ? "bg-[hsl(var(--ll-amber))]"
              : "bg-ink",
        )}
        style={{ width: `${Math.min(100, Math.max(2, pct * 100))}%` }}
      />
    </div>
  );
}

/** Table primitives: 40px rows, hairline between, sticky muted header. */
export const th =
  "h-8 whitespace-nowrap border-b border-hairline bg-surface-muted px-3 text-left text-[12px] font-medium text-[hsl(var(--ll-faint))] first:pl-4 last:pr-4";
export const td =
  "h-10 border-b border-hairline px-3 text-[13px] first:pl-4 last:pr-4";
/** A clickable table row: the accent tints it on hover and focus. */
export const rowLink =
  "cursor-pointer transition-colors hover:bg-brand-soft/60 focus-within:bg-brand-soft/60";

"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Bellwether's small shared vocabulary. Everything here styles itself with the
 * shell's semantic utilities (`bg-surface`, `text-ink`, `border-hairline`, …)
 * so the whole skin reskins from `theme.css` with no component edits.
 */

/** The standard panel. One radius, one hairline, one soft shadow, everywhere. */
export function Panel({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-hairline bg-surface shadow-soft",
        padded && "p-5",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

/** An eyebrow above a group. Uppercase, tracked, quiet — it labels, nothing more. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-[0.7rem] font-semibold uppercase tracking-[0.09em] text-ink-muted">
      {children}
    </h2>
  );
}

type Tone = "neutral" | "brand" | "positive" | "negative" | "markdown";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-surface-muted text-ink-muted border-hairline",
  brand: "bg-brand-soft text-brand border-brand/30",
  positive: "bg-positive-soft text-positive border-positive/25",
  negative: "bg-negative-soft text-negative border-negative/25",
  // `--brand-violet` is Bellwether's rose MARKDOWN accent (see theme.css), and
  // it is reserved for discounts and promotions so a markdown chip is the one
  // thing on a dense page that reads instantly from across a room.
  markdown: "bg-brand-violet/12 text-brand-violet border-brand-violet/30",
};

export function Pill({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.68rem] font-medium leading-4",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A headline figure with its label underneath. Tabular so digits don't jitter. */
export function Metric({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <div className="rounded-md border border-hairline bg-surface-muted px-4 py-3">
      <div
        className={cn(
          "bw-num text-xl font-semibold tracking-tight",
          tone === "negative" && "text-negative",
          tone === "positive" && "text-positive",
          tone === "brand" && "text-brand",
          tone === "neutral" && "text-ink",
          tone === "markdown" && "text-brand-violet",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[0.72rem] font-medium text-ink-muted">
        {label}
      </div>
      {hint ? (
        <div className="mt-0.5 text-[0.68rem] text-ink-muted">{hint}</div>
      ) : null}
    </div>
  );
}

/**
 * An empty state that tells you what to do next. Never a shrug — the frontend
 * brief is explicit that emptiness is an invitation to act, and in a demo an
 * unexplained blank panel reads as a bug.
 */
export function EmptyState({
  title,
  hint,
  icon,
}: {
  title: string;
  hint: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-hairline px-6 py-10 text-center">
      {icon ? <div className="mb-2 text-ink-muted">{icon}</div> : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 max-w-sm text-[0.78rem] text-ink-muted">{hint}</p>
    </div>
  );
}

/**
 * A control that the AGENT set, rather than the user.
 *
 * Beat 3c turns on the audience being able to SEE that a filter and a sort were
 * applied by the assistant — "it performed a maneuver, not a link". So an
 * agent-set control gets the brand tint plus a weight change; a user-set one
 * stays quiet. Banking and Rowan use the same treatment on their sort and
 * top-N controls.
 */
export function activeSelectClass(active: boolean): string {
  return cn(
    "rounded-md border px-2.5 py-1.5 text-[0.78rem] transition-colors",
    active
      ? "border-brand/50 bg-brand-soft font-semibold text-brand"
      : "border-hairline bg-surface text-ink-muted hover:text-ink",
  );
}

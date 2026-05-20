"use client";
/**
 * ParityBadge — small colored badge displaying the parity tier name.
 *
 * Color mapping:
 *   reference  = purple
 *   at_parity  = green (--ok)
 *   partial    = amber
 *   minimal    = amber/faded (reduced opacity)
 *   not_wired  = gray
 */

export type ParityTier =
  | "reference"
  | "at_parity"
  | "partial"
  | "minimal"
  | "not_wired";

const TIER_CONFIG: Record<ParityTier, { label: string; className: string }> = {
  reference: {
    label: "REF",
    className: "bg-purple-600/20 text-purple-400 border-purple-500/30",
  },
  at_parity: {
    label: "AT PARITY",
    className: "bg-[var(--ok)]/20 text-[var(--ok)] border-[var(--ok)]/30",
  },
  partial: {
    label: "PARTIAL",
    className:
      "bg-[var(--amber)]/20 text-[var(--amber)] border-[var(--amber)]/30",
  },
  minimal: {
    label: "MINIMAL",
    className:
      "bg-[var(--amber)]/20 text-[var(--amber)] border-[var(--amber)]/30 opacity-60",
  },
  not_wired: {
    label: "NOT WIRED",
    className:
      "bg-[var(--text-muted)]/10 text-[var(--text-muted)] border-[var(--text-muted)]/20",
  },
};

export function ParityBadge({ tier }: { tier: ParityTier }) {
  const config = TIER_CONFIG[tier];
  return (
    <span
      data-testid="parity-badge"
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border ${config.className}`}
    >
      {config.label}
    </span>
  );
}

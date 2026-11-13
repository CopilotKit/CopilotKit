"use client";

import React, { useCallback, useState } from "react";

export type SlotColor =
  | "indigo"
  | "violet"
  | "emerald"
  | "sky"
  | "amber"
  | "rose"
  | "orange"
  | "red"
  | "yellow"
  | "pink"
  | "cyan"
  | "teal"
  | "lime"
  | "fuchsia";

// Static lookups so Tailwind v4's source scanner finds every class string at
// build time. Dynamic concatenation like `border-${color}-400` would not work.
export const SLOT_COLORS: Record<
  SlotColor,
  { border: string; label: string; ring: string }
> = {
  indigo: {
    border: "border-indigo-400",
    label: "bg-indigo-500",
    ring: "ring-indigo-400/40",
  },
  violet: {
    border: "border-violet-400",
    label: "bg-violet-500",
    ring: "ring-violet-400/40",
  },
  emerald: {
    border: "border-emerald-400",
    label: "bg-emerald-500",
    ring: "ring-emerald-400/40",
  },
  sky: {
    border: "border-sky-400",
    label: "bg-sky-500",
    ring: "ring-sky-400/40",
  },
  amber: {
    border: "border-amber-400",
    label: "bg-amber-500",
    ring: "ring-amber-400/40",
  },
  rose: {
    border: "border-rose-400",
    label: "bg-rose-500",
    ring: "ring-rose-400/40",
  },
  orange: {
    border: "border-orange-400",
    label: "bg-orange-500",
    ring: "ring-orange-400/40",
  },
  red: {
    border: "border-red-400",
    label: "bg-red-500",
    ring: "ring-red-400/40",
  },
  yellow: {
    border: "border-yellow-400",
    label: "bg-yellow-500",
    ring: "ring-yellow-400/40",
  },
  pink: {
    border: "border-pink-400",
    label: "bg-pink-500",
    ring: "ring-pink-400/40",
  },
  cyan: {
    border: "border-cyan-400",
    label: "bg-cyan-500",
    ring: "ring-cyan-400/40",
  },
  teal: {
    border: "border-teal-400",
    label: "bg-teal-500",
    ring: "ring-teal-400/40",
  },
  lime: {
    border: "border-lime-400",
    label: "bg-lime-500",
    ring: "ring-lime-400/40",
  },
  fuchsia: {
    border: "border-fuchsia-400",
    label: "bg-fuchsia-500",
    ring: "ring-fuchsia-400/40",
  },
};

/**
 * Wraps a slot region with a dashed outline plus a small clickable badge
 * that copies the slot's component path to the clipboard.
 *
 * The label is opacity-0 by default and turns visible only when this marker
 * is hovered AND no descendant marker is also hovered. Markers nest
 * (welcomeScreen wraps welcomeMessage / input / suggestionView), so a plain
 * `:hover .slot-label { opacity: 1 }` would light up every nested label.
 * The `:not(:has(.slot-marker:hover))` predicate isolates each marker.
 */
export function SlotMarker({
  color,
  label,
  children,
  inline,
  className,
}: {
  color: SlotColor;
  label: string;
  children: React.ReactNode;
  inline?: boolean;
  className?: string;
}) {
  const c = SLOT_COLORS[color];
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(label);
        setCopied(true);
        setTimeout(() => setCopied(false), 1100);
      } catch {
        // clipboard may be unavailable (e.g. insecure context); silently no-op
      }
    },
    [label],
  );

  return (
    <span
      data-slot-label={label}
      className={`slot-marker relative ${inline ? "inline-flex" : "flex"} border border-dashed ${c.border} rounded-lg p-1 ${className ?? ""}`}
      style={{ flexDirection: inline ? "row" : "column" }}
    >
      <button
        type="button"
        onClick={onCopy}
        title={copied ? "Copied!" : `Copy slot path: ${label}`}
        aria-label={`Copy slot path ${label}`}
        className={`slot-label absolute -top-2 left-2 inline-flex items-center gap-1 rounded ${c.label} text-white text-[9px] font-bold uppercase tracking-wider px-1.5 py-px shadow-sm z-10 whitespace-nowrap opacity-0 transition-opacity hover:brightness-110 cursor-pointer pointer-events-auto font-mono normal-case tracking-normal`}
      >
        <span>{copied ? "Copied" : label}</span>
        <span aria-hidden="true" className="text-white/70 text-[8px]">
          {copied ? "✓" : "⧉"}
        </span>
      </button>
      <span style={{ display: "contents" }}>{children}</span>
    </span>
  );
}

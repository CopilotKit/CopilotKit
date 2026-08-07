"use client";

/**
 * ShadCN-flavoured Badge primitive (inline-cloned, no `cn()`/`cva`).
 * Variant palette mirrors ShadCN's default/secondary/destructive/outline,
 * extended with `success` / `warning` / `info` for status reporting.
 */
import React from "react";

export type BadgeVariant = "success" | "warning" | "error" | "info";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success: "border-transparent bg-emerald-100 text-emerald-800",
  warning: "border-transparent bg-amber-100 text-amber-800",
  error: "border-transparent bg-rose-100 text-rose-800",
  info: "border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)]",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({
  variant = "info",
  className = "",
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium tracking-wide ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}

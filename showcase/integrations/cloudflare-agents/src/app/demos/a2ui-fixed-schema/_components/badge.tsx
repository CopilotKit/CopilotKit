import * as React from "react";

/**
 * ShadCN-style Badge primitive (inline-cloned for this demo).
 * Plain Tailwind classes, no `cn()`/`cva` helpers.
 */
type Variant = "default" | "secondary" | "outline" | "success";

const variantClasses: Record<Variant, string> = {
  default:
    "border-transparent bg-neutral-900 text-neutral-50 dark:bg-primary dark:text-primary-foreground",
  secondary:
    "border-transparent bg-neutral-100 text-neutral-900 dark:bg-muted dark:text-foreground",
  outline:
    "border-neutral-200 text-neutral-700 bg-white dark:border-border dark:text-foreground dark:bg-card",
  success:
    "border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
}

export function Badge({
  className = "",
  variant = "default",
  ...props
}: BadgeProps) {
  return (
    <div
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-wide ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}

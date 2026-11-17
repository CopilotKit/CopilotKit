import * as React from "react";

// Inline-cloned shadcn/ui <Badge />. Plain Tailwind classes — no `cn()`,
// no `cva`. Local to this demo only.

type Variant = "default" | "secondary" | "outline" | "success" | "warning";

const variantClasses: Record<Variant, string> = {
  default:
    "border-transparent bg-neutral-900 dark:bg-primary text-neutral-50 dark:text-primary-foreground",
  secondary:
    "border-transparent bg-neutral-100 dark:bg-accent text-neutral-700 dark:text-foreground",
  outline:
    "border-neutral-200 dark:border-border text-neutral-900 dark:text-foreground",
  success:
    "border-transparent bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300",
  warning:
    "border-transparent bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300",
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
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}

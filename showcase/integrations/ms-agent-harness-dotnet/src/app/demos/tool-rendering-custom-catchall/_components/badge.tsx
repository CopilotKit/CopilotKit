import * as React from "react";

// Inline-cloned shadcn/ui <Badge />. Plain Tailwind classes — no `cn()`,
// no `cva`. Local to this demo only.

type Variant = "default" | "secondary" | "outline" | "success" | "warning";

const variantClasses: Record<Variant, string> = {
  default: "border-transparent bg-neutral-900 text-neutral-50",
  secondary: "border-transparent bg-neutral-100 text-neutral-700",
  outline: "border-neutral-200 text-neutral-900",
  success: "border-transparent bg-emerald-100 text-emerald-700",
  warning: "border-transparent bg-amber-100 text-amber-700",
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

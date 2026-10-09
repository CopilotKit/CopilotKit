import * as React from "react";

type Variant =
  | "default"
  | "secondary"
  | "outline"
  | "success"
  | "info"
  | "muted";

const variantClasses: Record<Variant, string> = {
  default: "border-transparent bg-neutral-900 text-neutral-50",
  secondary: "border-transparent bg-neutral-100 text-neutral-900",
  outline: "border-neutral-200 text-neutral-700 bg-white",
  success: "border-transparent bg-emerald-100 text-emerald-700",
  info: "border-transparent bg-indigo-100 text-indigo-700",
  muted: "border-transparent bg-neutral-100 text-neutral-500",
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
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}

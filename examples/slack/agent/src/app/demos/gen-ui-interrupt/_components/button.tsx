import * as React from "react";

type Variant = "default" | "outline" | "secondary" | "ghost" | "success";
type Size = "default" | "sm" | "lg";

const baseClasses =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

const variantClasses: Record<Variant, string> = {
  default: "bg-neutral-900 text-neutral-50 shadow-sm hover:bg-neutral-900/90",
  outline:
    "border border-neutral-200 bg-white text-neutral-900 shadow-sm hover:bg-neutral-100 hover:text-neutral-900",
  secondary: "bg-neutral-100 text-neutral-900 shadow-sm hover:bg-neutral-200",
  ghost: "hover:bg-neutral-100 hover:text-neutral-900",
  success: "bg-emerald-600 text-white shadow-sm hover:bg-emerald-600/90",
};

const sizeClasses: Record<Size, string> = {
  default: "h-9 px-4 py-2",
  sm: "h-8 rounded-md px-3 text-xs",
  lg: "h-10 rounded-md px-6",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className = "", variant = "default", size = "default", ...props },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

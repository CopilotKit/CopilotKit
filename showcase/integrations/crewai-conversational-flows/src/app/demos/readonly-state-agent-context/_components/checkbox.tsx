import * as React from "react";

export interface CheckboxProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
> {}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className = "", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type="checkbox"
        className={`h-5 w-5 shrink-0 rounded-md border border-neutral-300 text-neutral-900 accent-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        {...props}
      />
    );
  },
);
Checkbox.displayName = "Checkbox";

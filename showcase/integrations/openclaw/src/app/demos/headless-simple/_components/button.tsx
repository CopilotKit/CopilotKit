import * as React from "react";
import { cn } from "./cn";

export function Button({
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-xl bg-indigo-600 text-white",
        "transition-colors hover:bg-indigo-700",
        "disabled:pointer-events-none disabled:opacity-40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
        className,
      )}
      {...props}
    />
  );
}

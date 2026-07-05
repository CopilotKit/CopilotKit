import * as React from "react";
import { cn } from "./cn";

export function Badge({
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex cursor-pointer items-center rounded-full border border-neutral-200",
        "bg-neutral-100 px-3 py-1.5 text-xs font-normal text-neutral-700",
        "transition-colors hover:bg-neutral-200",
        className,
      )}
      {...props}
    />
  );
}

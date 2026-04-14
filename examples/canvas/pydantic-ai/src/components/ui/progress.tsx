import * as React from "react";

import { cn } from "@/lib/utils";

function Progress({ value, className, ...props }: React.ComponentProps<"div"> & { value?: number }) {
  const clamped = typeof value === "number" ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <div
        className="h-full w-full flex-1 bg-accent transition-all"
        style={{ transform: `translateX(-${100 - clamped}%)` }}
      />
    </div>
  );
}

export { Progress };

"use client";

import type React from "react";
import { cn } from "@/lib/utils";

export function EmptyState(props: { className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn(
      "grid place-items-center justify-center rounded-2xl p-8 border",
      "bg-border/50 border-foreground/10 transition-colors",
      "has-[button:hover]:bg-accent/10 has-[button:hover]:border-accent/25",
      props.className
    )}>
      {props.children}
    </div>
  );
}



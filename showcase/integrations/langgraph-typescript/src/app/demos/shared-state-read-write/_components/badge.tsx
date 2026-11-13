"use client";

import React from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "outline" | "secondary" | "selected";
}

export function Badge({
  variant = "default",
  className = "",
  children,
  ...props
}: BadgeProps) {
  const variantClass =
    variant === "selected"
      ? "bg-[#BEC2FF1A] text-[#010507] border-[#BEC2FF] dark:text-foreground"
      : variant === "outline"
        ? "bg-white text-[#57575B] border-[#DBDBE5] hover:bg-[#FAFAFC] dark:bg-card dark:text-muted-foreground dark:border-border dark:hover:bg-muted"
        : variant === "secondary"
          ? "bg-[#FAFAFC] text-[#57575B] border-[#E9E9EF] dark:bg-muted dark:text-muted-foreground dark:border-border"
          : "bg-[#010507] text-white border-[#010507] dark:bg-primary dark:text-primary-foreground dark:border-primary";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors ${variantClass} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}

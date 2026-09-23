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
      ? "bg-[#BEC2FF1A] text-[#010507] border-[#BEC2FF]"
      : variant === "outline"
        ? "bg-white text-[#57575B] border-[#DBDBE5] hover:bg-[#FAFAFC]"
        : variant === "secondary"
          ? "bg-[#FAFAFC] text-[#57575B] border-[#E9E9EF]"
          : "bg-[#010507] text-white border-[#010507]";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors ${variantClass} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}

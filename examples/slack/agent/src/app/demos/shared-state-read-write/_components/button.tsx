"use client";

import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "destructive";
  size?: "default" | "sm" | "lg";
}

export function Button({
  variant = "default",
  size = "default",
  className = "",
  children,
  ...props
}: ButtonProps) {
  const variantClass =
    variant === "outline"
      ? "border border-[#DBDBE5] bg-white text-[#010507] hover:bg-[#FAFAFC]"
      : variant === "ghost"
        ? "bg-transparent text-[#57575B] hover:bg-[#FAFAFC]"
        : variant === "destructive"
          ? "border border-[#DBDBE5] bg-white text-[#57575B] hover:text-[#FA5F67] hover:border-[#FA5F67]"
          : "bg-[#010507] text-white hover:bg-[#1F1F23]";

  const sizeClass =
    size === "sm"
      ? "h-8 rounded-full px-3 text-xs"
      : size === "lg"
        ? "h-11 rounded-xl px-6 text-sm"
        : "h-9 rounded-xl px-4 text-sm";

  return (
    <button
      className={`inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#BEC2FF33] disabled:pointer-events-none disabled:opacity-50 ${variantClass} ${sizeClass} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

"use client";

import React from "react";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className = "", ...props }, ref) {
  return (
    <input
      ref={ref}
      className={`flex h-10 w-full rounded-xl border border-[#DBDBE5] bg-white px-3 py-2 text-sm text-[#010507] placeholder:text-[#838389] focus:border-[#BEC2FF] focus:outline-none focus:ring-2 focus:ring-[#BEC2FF33] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  );
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className = "", children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={`flex h-10 w-full rounded-xl border border-[#DBDBE5] bg-white px-3 py-2 text-sm text-[#010507] focus:border-[#BEC2FF] focus:outline-none focus:ring-2 focus:ring-[#BEC2FF33] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </select>
  );
});

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(function Label({ className = "", ...props }, ref) {
  return (
    <label
      ref={ref}
      className={`text-sm font-medium text-[#57575B] ${className}`}
      {...props}
    />
  );
});

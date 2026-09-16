"use client";

/**
 * ShadCN-flavoured Card primitive (inline-cloned, no `cn()`/`cva`).
 * Uses the showcase's `--card` / `--border` / `--foreground` /
 * `--muted-foreground` CSS variables so the demo respects light/dark.
 */
import React from "react";

export function Card({
  children,
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)] shadow-sm ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  children,
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex flex-col gap-1.5 px-6 pt-5 pb-3 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  className = "",
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={`text-base font-semibold leading-none tracking-tight ${className}`}
      {...props}
    >
      {children}
    </h3>
  );
}

export function CardDescription({
  children,
  className = "",
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={`text-sm text-[var(--muted-foreground)] ${className}`}
      {...props}
    >
      {children}
    </p>
  );
}

export function CardContent({
  children,
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-6 pb-5 ${className}`} {...props}>
      {children}
    </div>
  );
}

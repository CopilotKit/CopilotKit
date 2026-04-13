import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    paid: "text-emerald-700 bg-emerald-50",
    completed: "text-emerald-700 bg-emerald-50",
    active: "text-emerald-700 bg-emerald-50",
    "in-stock": "text-emerald-700 bg-emerald-50",
    pending: "text-amber-700 bg-amber-50",
    "low-stock": "text-amber-700 bg-amber-50",
    "on-leave": "text-amber-700 bg-amber-50",
    overdue: "text-red-700 bg-red-50",
    failed: "text-red-700 bg-red-50",
    "out-of-stock": "text-red-700 bg-red-50",
    terminated: "text-red-700 bg-red-50",
    draft: "text-muted-foreground bg-muted",
  };
  return colors[status] || "text-muted-foreground bg-muted";
}

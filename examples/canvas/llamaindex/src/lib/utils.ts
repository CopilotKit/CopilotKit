import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getContentArg(args: Record<string, unknown>) {
  const rec = (args as Record<string, unknown>) || {};
  return typeof rec.content === "string" ? rec.content : null;
}

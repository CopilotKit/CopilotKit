import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const truncateUrl = (url: string, maxLength: number = 40) => {
  if (!url) return "";
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength - 3) + "...";
};

import { clsx, type ClassValue } from "clsx";

/**
 * Utility function to merge class names.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

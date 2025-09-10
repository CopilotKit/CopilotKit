import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatText(text: string): string {
  if (!text) return "";

  // First check if text already has formatting (multiple consecutive newlines)
  const hasFormatting = /\n\s*\n/.test(text);

  // Process markdown elements first
  let formatted = text;

  // Convert markdown bold (**text**) to HTML bold
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  if (hasFormatting) {
    // Just convert newlines to <br> tags for pre-formatted text
    return formatted.replace(/\n/g, "<br>");
  } else {
    // For unformatted text, add proper spacing

    // Add double line breaks before restaurant entries (already converted to HTML)
    formatted = formatted.replace(/(<strong>\d+\.)/g, "<br><br>$1");

    // Add single line breaks before each property
    formatted = formatted.replace(/(\s-\s<strong>)/g, "<br>$1");

    return formatted;
  }
}

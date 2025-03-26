"use client";
import React from "react";
import { useCoagentsCrewStarter } from "@/hooks/use-coagents-crew-starter";

// Utility method for cleaning output from Crew, for demonstration purposes only
function formatText(text: string): string {
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

export default function CoagentsCrewStarter() {
  const { output } = useCoagentsCrewStarter({
    crewName: process.env.NEXT_PUBLIC_CREW_NAME!,
    /**
     * List of inputs needed to start your crew (e.g., location).
     * This creates a form in the chat for the user to fill out.
     * When submitted, the inputs are passed to the crew.
     */
    inputs: ["YOUR_INPUT"],
  });
  return (
    <div className="text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 rounded-md shadow-sm p-4 h-[calc(100%-2rem)] overflow-y-auto whitespace-pre-line">
      <div dangerouslySetInnerHTML={{ __html: formatText(output) }} />
    </div>
  );
}

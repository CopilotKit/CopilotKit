"use client";
import React from "react";
import { useCoagentsCrewStarter } from "@/hooks/use-coagents-crew-starter";

/**
 * Format text output from the Crew for better readability
 * 
 * This utility function:
 * - Preserves existing formatting if present
 * - Converts markdown bold (**text**) to HTML <strong> tags
 * - Adds appropriate spacing for listed items
 * - Handles both pre-formatted and unformatted text
 * 
 * @param text - The raw text output from the crew
 * @returns Formatted HTML string ready for display
 */
function formatText(text: string): string {
  if (!text) return "";

  // Check if text already has formatting (multiple consecutive newlines)
  const hasFormatting = /\n\s*\n/.test(text);

  // Process markdown elements
  let formatted = text;

  // Convert markdown bold to HTML bold
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  
  // Convert markdown lists to proper HTML with spacing
  formatted = formatted.replace(/^- (.+)$/gm, "<li>$1</li>");
  formatted = formatted.replace(/(<li>.+<\/li>\n)+/g, "<ul class='list-disc pl-5 my-2'>$&</ul>");

  if (hasFormatting) {
    // Just convert newlines to <br> tags for pre-formatted text
    return formatted.replace(/\n/g, "<br>");
  } else {
    // For unformatted text, add proper spacing
    // Add double line breaks before numbered items
    formatted = formatted.replace(/(\d+\.)/g, "<br><br>$1");

    // Add single line breaks before properties
    formatted = formatted.replace(/(\s-\s)/g, "<br>$1");

    return formatted;
  }
}

/**
 * Main component for the Copilot Crew interface
 * 
 * This component:
 * 1. Initializes the crew with required input fields
 * 2. Renders the formatted output from the crew
 * 3. Provides a clean, readable interface for users
 */
export default function CoagentsCrewStarter() {
  const { output } = useCoagentsCrewStarter({
    /**
     * Define the input fields needed to start your crew.
     * These will be presented as a form in the chat interface.
     */
    inputs: ["YOUR_INPUTS_HERE"],
  });

  return (
    <div className="p-6 h-full overflow-y-auto">
      <h2 className="text-xl font-semibold mb-4 text-zinc-800 dark:text-zinc-100 border-b border-zinc-200 dark:border-zinc-700 pb-2">
        Crew Results
      </h2>
      
      {!output || output === "Crew result will appear here..." ? (
        <div className="flex flex-col items-center justify-center h-[calc(100%-3rem)] text-center p-6 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div className="text-zinc-400 dark:text-zinc-500 text-sm italic mb-2">
            Waiting for input...
          </div>
          <div className="text-zinc-500 dark:text-zinc-400 font-medium">
            Results will appear here after providing inputs in the chat
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 shadow-sm">
          <div 
            className="prose prose-sm dark:prose-invert max-w-none text-zinc-800 dark:text-zinc-200 whitespace-pre-line"
            dangerouslySetInnerHTML={{ __html: formatText(output) }} 
          />
        </div>
      )}
    </div>
  );
}

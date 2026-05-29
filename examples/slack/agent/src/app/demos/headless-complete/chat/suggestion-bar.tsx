"use client";

/**
 * Live suggestion pills rendered above the composer. Reads from
 * `useSuggestions` (configured by `useHeadlessSuggestions`) so the
 * Complete demo actually *displays* its suggestions instead of just
 * configuring them.
 *
 * Hidden when there are no suggestions or when the agent is running.
 */

import React from "react";
import { useSuggestions } from "@copilotkit/react-core/v2";
import { Badge } from "@/components/ui/badge";

export function SuggestionBar({
  agentId,
  isRunning,
  onPick,
}: {
  agentId: string;
  isRunning: boolean;
  onPick: (message: string) => void;
}) {
  const { suggestions } = useSuggestions({ agentId });

  if (isRunning || suggestions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 pb-2 pt-1 sm:px-4">
      {suggestions.map((s, i) => (
        <Badge
          key={`${s.title}-${i}`}
          asChild
          variant="secondary"
          className="cursor-pointer px-3 py-1.5 text-xs font-normal hover:bg-secondary/80"
        >
          <button
            type="button"
            onClick={() => onPick(s.message)}
            disabled={s.isLoading}
            aria-label={`Suggestion: ${s.title}`}
          >
            {s.title}
          </button>
        </Badge>
      ))}
    </div>
  );
}

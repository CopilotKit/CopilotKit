"use client";

/**
 * Card-style header for the chat shell. Title + description on the left,
 * a ghost reset icon button on the right (`CardAction`). The reset
 * handler aborts any in-flight run before clearing messages.
 */

import React from "react";
import { RotateCcw, Sparkles } from "lucide-react";
import {
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function Header({
  onReset,
  canReset,
}: {
  onReset: () => void;
  canReset: boolean;
}) {
  return (
    <CardHeader className="border-b border-border/60 py-4">
      <CardTitle className="flex items-center gap-2 text-base">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
        Headless Chat
      </CardTitle>
      <CardDescription>
        Built without &lt;CopilotChat&gt; — full headless surface.
      </CardDescription>
      <CardAction>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onReset}
          disabled={!canReset}
          aria-label="Reset conversation"
          title="Reset conversation"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </CardAction>
    </CardHeader>
  );
}

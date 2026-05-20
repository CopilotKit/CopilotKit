"use client";

/**
 * Three pulsing dots inside an assistant-styled bubble. Shown while the
 * agent is running but has not yet streamed any content/tool calls.
 */

import React from "react";
import { Bot } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function TypingIndicator() {
  return (
    <div className="flex w-full items-start gap-3">
      <Avatar className="h-8 w-8 shrink-0 border bg-muted text-muted-foreground">
        <AvatarFallback className="bg-muted text-muted-foreground">
          <Bot className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>
      <div className="rounded-2xl rounded-tl-sm bg-muted px-4 py-3 shadow-sm">
        <div className="flex items-center gap-1">
          <span
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
            style={{ animationDelay: "300ms" }}
          />
        </div>
      </div>
    </div>
  );
}

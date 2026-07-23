"use client";

/**
 * Frontend tool render component for `highlight_note`. The agent calls the
 * tool with `{ text, color }` and CopilotKit renders this component in
 * place. Wired up via `useComponent` in `hooks/use-frontend-components.ts`.
 */

import React from "react";
import { Highlighter } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const palette: Record<string, { card: string; chip: string; text: string }> = {
  yellow: {
    card: "border-yellow-300 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/40",
    chip: "bg-yellow-200 text-yellow-900 dark:bg-yellow-800 dark:text-yellow-50",
    text: "text-yellow-900 dark:text-yellow-100",
  },
  pink: {
    card: "border-pink-300 bg-pink-50 dark:border-pink-900 dark:bg-pink-950/40",
    chip: "bg-pink-200 text-pink-900 dark:bg-pink-800 dark:text-pink-50",
    text: "text-pink-900 dark:text-pink-100",
  },
  green: {
    card: "border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-950/40",
    chip: "bg-green-200 text-green-900 dark:bg-green-800 dark:text-green-50",
    text: "text-green-900 dark:text-green-100",
  },
  blue: {
    card: "border-blue-300 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40",
    chip: "bg-blue-200 text-blue-900 dark:bg-blue-800 dark:text-blue-50",
    text: "text-blue-900 dark:text-blue-100",
  },
};

export function HighlightNote({
  text,
  color,
}: {
  text: string;
  color: string;
}) {
  const c = palette[color] ?? palette.yellow;
  return (
    <Card
      data-testid="headless-highlight-card"
      className={cn("gap-2 py-3", c.card)}
    >
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
          <Highlighter className={cn("h-4 w-4", c.text)} />
          <Badge
            variant="secondary"
            className={cn("border-transparent", c.chip)}
          >
            Highlight
          </Badge>
        </CardTitle>
        <CardAction>
          <span className="text-[10px] text-muted-foreground">
            frontend tool
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="px-4">
        <p className={cn("text-sm font-medium", c.text)}>{text}</p>
      </CardContent>
    </Card>
  );
}

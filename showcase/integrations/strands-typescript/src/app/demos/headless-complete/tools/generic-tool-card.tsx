"use client";

/**
 * Catch-all card rendered for any backend tool that doesn't have its own
 * dedicated `useRenderTool`. Includes unknown MCP tool names. Wired up via
 * `useDefaultRenderTool` in `hooks/use-tool-renderers.ts`.
 */

import React from "react";
import { Loader2, Wrench } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function GenericToolCard({
  name,
  parameters,
  result,
  status,
}: {
  name: string;
  parameters: unknown;
  result: string | undefined;
  status: "inProgress" | "executing" | "complete";
}) {
  const isComplete = status === "complete";
  return (
    <Card className="gap-2 py-3">
      <CardHeader className="px-4 [.border-b]:pb-3">
        <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Wrench className="h-4 w-4 text-foreground" />
          {name}
        </CardTitle>
        {!isComplete && (
          <CardAction>
            <Badge
              variant="secondary"
              className="gap-1 text-[10px] font-normal"
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              running
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="px-4">
        <details className="group">
          <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground">
            <span className="font-medium">
              {isComplete ? "Tool completed" : "Tool running..."}
            </span>
            <span className="ml-2 text-muted-foreground/70 group-open:hidden">
              show
            </span>
            <span className="ml-2 hidden text-muted-foreground/70 group-open:inline">
              hide
            </span>
          </summary>
          <div className="mt-2 space-y-2">
            {parameters !== undefined && parameters !== null && (
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Input
                </div>
                <pre className="overflow-x-auto rounded-md border bg-muted p-2 font-mono text-[11px] leading-snug text-foreground">
                  {safeStringify(parameters)}
                </pre>
              </div>
            )}
            {result !== undefined && (
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Output
                </div>
                <pre className="overflow-x-auto rounded-md border bg-muted p-2 font-mono text-[11px] leading-snug text-foreground">
                  {prettyResult(result)}
                </pre>
              </div>
            )}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function prettyResult(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

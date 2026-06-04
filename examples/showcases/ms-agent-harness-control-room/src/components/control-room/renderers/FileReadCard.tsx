"use client";

/**
 * Card rendered for fixture-file reads. The Microsoft Harness
 * FileAccessProvider owns sandboxing; this renderer keeps file reads visible
 * in the workstream while collapsing source content until the presenter needs it.
 */

import { useState } from "react";
import { AlertCircle, ChevronDown } from "lucide-react";

import {
  CodeBlock,
  languageFromPath,
} from "@/components/control-room/renderers/CodeBlock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface FileReadCardProps {
  args?: { relative_path?: string; fileName?: string; path?: string };
  status?: string;
  result?: string | { path?: string; fileName?: string; content?: string };
}

export function FileReadCard({ args, status, result }: FileReadCardProps) {
  const [open, setOpen] = useState(false);
  const resultObject =
    typeof result === "object" && result !== null ? result : null;
  const path =
    resultObject?.path ??
    resultObject?.fileName ??
    args?.relative_path ??
    args?.fileName ??
    args?.path ??
    "(unknown path)";
  const content =
    typeof result === "string" ? result : (resultObject?.content ?? "");
  const isComplete = status === "complete";
  const isError = isComplete && /not found|error|failed/i.test(content);
  const lineCount = content ? content.split(/\r\n|\r|\n/).length : 0;
  const summary =
    !isComplete && !result
      ? "Reading"
      : isError
        ? "Read failed"
        : content
          ? `${lineCount} line${lineCount === 1 ? "" : "s"}`
          : "Empty file";

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Card
        size="sm"
        className="my-2 max-w-3xl gap-0 rounded-xl py-0 shadow-none ring-border"
      >
        <div className="flex min-h-[3.25rem] items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <CardTitle className="min-w-0 truncate font-mono text-sm font-medium">
                Harness event · FileAccess_ReadFile
              </CardTitle>
              <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">
                {path}
              </span>
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground sm:hidden">
              {path}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{summary}</div>
          </div>
          <StatusBadge status={status} />
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="shrink-0 gap-1.5"
              aria-label={`${open ? "Hide" : "Show"} ${path}`}
            >
              {open ? "Hide" : "Show"}
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  open && "rotate-180",
                )}
              />
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <CardContent className="border-t bg-muted/15 py-3">
            {!isComplete && !result ? (
              <p className="text-xs text-muted-foreground">Reading file...</p>
            ) : isError ? (
              <div className="flex gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{content}</span>
              </div>
            ) : content ? (
              <CodeBlock
                code={content}
                language={languageFromPath(path)}
                maxHeight={320}
              />
            ) : (
              <p className="text-xs italic text-muted-foreground">
                (empty file)
              </p>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const tone =
    status === "complete"
      ? "emerald"
      : status === "executing"
        ? "amber"
        : status === "inProgress"
          ? "cyan"
          : undefined;

  return (
    <Badge
      variant="outline"
      className={cn(
        "hidden sm:inline-flex",
        tone === "emerald" &&
          "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "amber" && "border-amber-200 bg-amber-50 text-amber-700",
        tone === "cyan" && "border-cyan-200 bg-cyan-50 text-cyan-700",
      )}
    >
      {status ?? "pending"}
    </Badge>
  );
}

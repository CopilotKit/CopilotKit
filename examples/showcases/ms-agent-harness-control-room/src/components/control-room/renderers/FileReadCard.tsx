"use client";

/**
 * Card rendered for fixture-file reads. The Microsoft Harness
 * FileAccessProvider owns sandboxing; this renderer keeps file content visible
 * in the stage workstream instead of hiding it behind a generic tool card.
 */

import { AlertCircle, FileText } from "lucide-react";

import {
  CodeBlock,
  languageFromPath,
} from "@/components/control-room/renderers/CodeBlock";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface FileReadCardProps {
  args?: { relative_path?: string; fileName?: string; path?: string };
  status?: string;
  result?: string | { path?: string; fileName?: string; content?: string };
}

export function FileReadCard({ args, status, result }: FileReadCardProps) {
  const resultObject =
    typeof result === "object" && result !== null ? result : null;
  const path =
    resultObject?.path ??
    resultObject?.fileName ??
    args?.relative_path ??
    args?.fileName ??
    args?.path ??
    "(unknown path)";
  const content = typeof result === "string" ? result : (resultObject?.content ?? "");
  const isComplete = status === "complete";
  const isError = isComplete && /not found|error|failed/i.test(content);

  return (
    <Card
      size="sm"
      className="my-3 max-w-3xl rounded-xl py-4 shadow-none ring-border"
    >
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md border bg-muted p-2 text-muted-foreground">
            <FileText size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm">File read</CardTitle>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {path}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
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
          <p className="text-xs italic text-muted-foreground">(empty file)</p>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

/**
 * Card rendered for the agent's final `generated_result_card` tool call.
 *
 * This is a *native* primitive (the agent's final output card), so it does
 * NOT show the live-wrapper badge. Markdown is rendered as plain
 * whitespace-preserved text on purpose: we don't want to pull in a markdown
 * dependency just for this showcase demo.
 */

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CodeBlock } from "@/components/control-room/renderers/CodeBlock";

interface GeneratedResultCardProps {
  args?: {
    title?: string;
    body_markdown?: string;
    status?: string;
  };
  status?: string;
  result?: {
    title: string;
    body_markdown: string;
    status: string;
    timestamp: string;
  };
}

export function GeneratedResultCard({
  args,
  status,
  result,
}: GeneratedResultCardProps) {
  const title = result?.title ?? args?.title ?? "Generated result";
  const body = result?.body_markdown ?? args?.body_markdown ?? "";
  const cardStatus = (
    result?.status ??
    args?.status ??
    "pending"
  ).toLowerCase();
  const timestamp = result?.timestamp;
  const showSpinner = status !== "complete" && !result;

  return (
    <Card
      size="sm"
      className="my-3 max-w-3xl rounded-xl py-4 shadow-none ring-border"
    >
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="mr-auto text-sm">{title}</CardTitle>
          <StatusPill status={cardStatus} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <section className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            Markdown source
          </div>
          {showSpinner ? (
            <p className="text-xs text-muted-foreground">
              Awaiting generated output...
            </p>
          ) : (
            <CodeBlock
              code={body || "(empty body)"}
              language="markdown"
              maxHeight={320}
            />
          )}
        </section>
        {timestamp && (
          <p className="text-xs text-muted-foreground">Emitted at {timestamp}</p>
        )}
      </CardContent>
    </Card>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "success" ? "emerald" : status === "failure" ? "red" : "amber";
  return (
    <Badge
      variant="outline"
      className={
        tone === "emerald"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : tone === "red"
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-amber-200 bg-amber-50 text-amber-700"
      }
    >
      {status}
    </Badge>
  );
}

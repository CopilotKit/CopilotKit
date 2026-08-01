"use client";

/** First-load pane: heading, sparkles icon, and three sample prompt chips. */

import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const SAMPLES = [
  "Say hello in one short sentence.",
  "Tell me a one-line joke.",
  "Give me a fun fact.",
];

export function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-6 px-8 py-10 text-center">
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Sparkles className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight">
          Start a conversation
        </h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Two hooks, one shadcn shell — text in, text out.
        </p>
      </div>
      <div className="flex w-full max-w-md flex-wrap items-center justify-center gap-2">
        {SAMPLES.map((s) => (
          <Badge
            key={s}
            asChild
            variant="secondary"
            className="cursor-pointer px-3 py-1.5 text-xs font-normal hover:bg-secondary/80"
          >
            <button type="button" onClick={() => onPick(s)}>
              {s}
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}

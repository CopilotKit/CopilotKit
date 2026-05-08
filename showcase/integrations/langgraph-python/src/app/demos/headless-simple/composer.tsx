"use client";

/** Bottom-of-chat input. Enter sends, Shift+Enter inserts a newline. */

import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function Composer({
  value,
  onChange,
  onSend,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  disabled: boolean;
}) {
  return (
    <div data-testid="headless-composer" className="bg-background p-3 sm:p-4">
      <div
        className={cn(
          "flex items-end gap-2 rounded-2xl border border-border/60 bg-muted/50 p-2",
          "focus-within:bg-background focus-within:ring-2 focus-within:ring-ring/40",
          "transition-colors",
        )}
      >
        <Textarea
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!disabled) onSend();
            }
          }}
          placeholder="Message the agent..."
          className={cn(
            "min-h-[40px] max-h-40 flex-1 resize-none border-0 bg-transparent",
            "px-2 py-2 text-sm shadow-none",
            "focus-visible:ring-0 focus-visible:border-transparent",
          )}
        />
        <Button
          type="button"
          size="icon"
          onClick={onSend}
          disabled={disabled}
          aria-label="Send message"
          className="h-9 w-9 shrink-0 rounded-xl"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

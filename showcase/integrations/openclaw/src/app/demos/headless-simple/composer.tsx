"use client";

/** Bottom-of-chat input. Enter sends, Shift+Enter inserts a newline. */

import { ArrowUp } from "lucide-react";
import { Button } from "./_components/button";
import { Textarea } from "./_components/textarea";
import { cn } from "./_components/cn";

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
    <div data-testid="headless-composer" className="bg-white p-3 sm:p-4">
      <div
        className={cn(
          "flex items-end gap-2 rounded-2xl border border-neutral-200 bg-neutral-50 p-2",
          "transition-colors focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-400/50",
        )}
      >
        <Textarea
          data-testid="headless-input"
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
          className="max-h-40 min-h-[40px] flex-1 px-2 py-2"
        />
        <Button
          type="button"
          onClick={onSend}
          disabled={disabled}
          aria-label="Send message"
          className="h-9 w-9 shrink-0"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

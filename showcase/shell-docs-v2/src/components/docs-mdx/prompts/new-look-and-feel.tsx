"use client";

import { useState, type ReactNode } from "react";
import {
  Check,
  Copy,
  MessageCircle,
  RefreshCw,
  SendHorizontal,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const SUGGESTIONS = [
  "Plan a weekend project",
  "Draft a quick reply",
  "Show me what changed",
];

/**
 * A click-through mock of the 1.8.2 chat UI (shell-docs'
 * `NewLookAndFeelPreview`). shell-docs floated it in the bottom-right corner;
 * that corner is the "Ask AI" button's here, so the launcher and the window
 * open in place, at the end of the section.
 */
export function NewLookAndFeelPreview() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <div className="not-prose my-6 flex flex-col items-end gap-3">
      {open ? (
        <aside
          aria-label="CopilotKit new look and feel preview"
          className="flex max-h-[min(660px,calc(100vh-8rem))] w-full max-w-[390px] flex-col overflow-hidden rounded-xl border bg-card text-foreground shadow-lift"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-3">
              <FrameworkLogo slug="built-in-agent" size={24} />
              <div>
                <div className="text-sm font-semibold">CopilotKit</div>
                <div className="text-xs text-muted-foreground">
                  New look and feel
                </div>
              </div>
            </div>
            <Badge variant="outline" className="h-6 gap-1.5 px-2">
              <span
                aria-hidden
                className="size-2 rounded-full bg-brand-mint-deep ring-3 ring-tile-mint"
              />
              Ready
            </Badge>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
            <div className="max-w-[82%] rounded-xl border px-4 py-3">
              Hey there. Let&apos;s have a fun conversation.
            </div>
            <div className="ml-auto max-w-[78%] rounded-xl bg-secondary px-4 py-3">
              What changed in 1.8.2?
            </div>
            <div className="max-w-[88%] rounded-xl border px-4 py-3">
              The chat UI has refreshed styling, first-class feedback actions,
              and built-in dark mode support.
              <div className="mt-3 flex items-center gap-1 text-muted-foreground">
                <Action label="Thumbs up">
                  <ThumbsUp />
                </Action>
                <Action label="Thumbs down">
                  <ThumbsDown />
                </Action>
                <Action
                  label={copied ? "Copied" : "Copy"}
                  onClick={() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                  }}
                >
                  {copied ? <Check className="text-primary" /> : <Copy />}
                </Action>
                <Action label="Regenerate">
                  <RefreshCw />
                </Action>
              </div>
            </div>
            <div className="grid gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="rounded-lg border px-3 py-2 text-left text-xs font-medium text-primary transition-colors hover:border-edge-action hover:bg-accent"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t p-3">
            <div className="flex items-center gap-2 rounded-xl border px-3 py-2">
              <input
                readOnly
                value="Ask anything..."
                aria-label="Preview chat input"
                className="min-w-0 flex-1 bg-transparent text-sm text-muted-foreground outline-none"
              />
              <Button
                size="icon"
                aria-label="Send preview message"
                className="rounded-full bg-foreground text-background hover:bg-foreground/85"
              >
                <SendHorizontal />
              </Button>
            </div>
          </div>
        </aside>
      ) : null}

      <div className="flex items-center gap-3">
        {open ? null : (
          <span className="text-sm text-muted-foreground">
            Open the preview
          </span>
        )}
        <Button
          variant="outline"
          aria-label={
            open ? "Close the new look preview" : "Open CopilotKit new look preview"
          }
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="size-14 rounded-full bg-card text-primary shadow-lift [&_svg:not([class*='size-'])]:size-6"
        >
          {open ? <X /> : <MessageCircle />}
        </Button>
      </div>
    </div>
  );
}

function Action({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      onClick={onClick}
      className="hover:text-primary"
    >
      {children}
    </Button>
  );
}

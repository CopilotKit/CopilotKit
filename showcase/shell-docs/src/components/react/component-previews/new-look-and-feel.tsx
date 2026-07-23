"use client";

import React from "react";
import {
  Check,
  Copy,
  MessageCircle,
  RefreshCw,
  SendHorizontal,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";

import { CopilotKitMark } from "@/components/copilotkit-mark";
import { cn } from "@/lib/cn";

const suggestions = [
  "Plan a weekend project",
  "Draft a quick reply",
  "Show me what changed",
];

export function NewLookAndFeelPreview() {
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Open CopilotKit new look preview"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "shell-docs-radius-icon fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center border shadow-[var(--shadow-panel)] transition",
          "border-[var(--border)] bg-[var(--bg-surface)] text-[var(--accent)] hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)]",
        )}
      >
        {open ? (
          <X className="h-6 w-6" />
        ) : (
          <MessageCircle className="h-6 w-6" />
        )}
      </button>

      {open ? (
        <aside
          aria-label="CopilotKit new look and feel preview"
          className={cn(
            "shell-docs-radius-surface fixed bottom-24 left-4 right-4 z-50 mx-auto flex max-h-[min(660px,calc(100vh-8rem))] w-auto max-w-[390px] flex-col overflow-hidden border shadow-[var(--shadow-modal)]",
            "border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text)]",
            "sm:left-auto sm:right-5 sm:mx-0 sm:w-[390px]",
          )}
        >
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="shell-docs-radius-icon flex h-9 w-9 items-center justify-center bg-[var(--accent-dim)]">
                <CopilotKitMark className="h-6 w-6" />
              </div>
              <div>
                <div className="text-sm font-semibold">CopilotKit</div>
                <div className="text-xs text-[var(--text-muted)]">
                  New look and feel
                </div>
              </div>
            </div>
            <div className="shell-docs-radius-control flex h-7 items-center gap-1 border border-[var(--accent)] bg-[var(--accent-dim)] px-2 text-xs font-medium text-[var(--accent)]">
              <Sparkles className="h-3.5 w-3.5" />
              Ready
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto bg-[var(--bg)] px-4 py-4">
            <div className="shell-docs-radius-surface max-w-[82%] border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-sm shadow-[var(--shadow-control)]">
              Hey there. Let&apos;s have a fun conversation.
            </div>

            <div className="shell-docs-radius-surface ml-auto max-w-[78%] bg-[var(--accent)] px-4 py-3 text-sm text-[var(--primary-foreground)] shadow-[var(--shadow-control)]">
              What changed in 1.8.2?
            </div>

            <div className="shell-docs-radius-surface max-w-[88%] border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-sm shadow-[var(--shadow-control)]">
              The chat UI has refreshed styling, first-class feedback actions,
              and built-in dark mode support.
              <div className="mt-3 flex items-center gap-1.5 text-[var(--text-muted)]">
                <ActionButton label="Thumbs up">
                  <ThumbsUp className="h-3.5 w-3.5" />
                </ActionButton>
                <ActionButton label="Thumbs down">
                  <ThumbsDown className="h-3.5 w-3.5" />
                </ActionButton>
                <ActionButton
                  label={copied ? "Copied" : "Copy"}
                  onClick={() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                  }}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </ActionButton>
                <ActionButton label="Regenerate">
                  <RefreshCw className="h-3.5 w-3.5" />
                </ActionButton>
              </div>
            </div>

            <div className="grid gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="shell-docs-radius-control border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-left text-xs font-medium text-[var(--accent)] transition hover:border-[var(--accent)] hover:bg-[var(--accent-dim)]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-[var(--border)] bg-[var(--bg-surface)] p-3">
            <div className="shell-docs-radius-control flex items-center gap-2 border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2">
              <input
                readOnly
                value="Ask anything..."
                aria-label="Preview chat input"
                className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-muted)] outline-none"
              />
              <button
                type="button"
                aria-label="Send preview message"
                className="shell-docs-radius-icon flex h-8 w-8 items-center justify-center bg-[var(--accent)] text-[var(--primary-foreground)] transition hover:bg-[var(--accent-strong)]"
              >
                <SendHorizontal className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>
      ) : null}
    </>
  );
}

function ActionButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="shell-docs-radius-icon flex h-7 w-7 items-center justify-center transition hover:bg-[var(--accent-dim)] hover:text-[var(--accent)]"
    >
      {children}
    </button>
  );
}

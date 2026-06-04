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
          "fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full border shadow-xl transition",
          "border-[#d8d0ef] bg-white text-[#4f2c86] hover:-translate-y-0.5 hover:shadow-2xl",
          "dark:border-white/15 dark:bg-[#1f2230] dark:text-[#d8c8ff]",
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
            "fixed bottom-24 left-4 right-4 z-50 mx-auto flex max-h-[min(660px,calc(100vh-8rem))] w-auto max-w-[390px] flex-col overflow-hidden rounded-2xl border shadow-2xl",
            "border-[#ded8ed] bg-white text-[#202124]",
            "dark:border-white/15 dark:bg-[#17191f] dark:text-white",
            "sm:left-auto sm:right-5 sm:mx-0 sm:w-[390px]",
          )}
        >
          <div className="flex items-center justify-between border-b border-[#ece7f6] px-4 py-3 dark:border-white/10">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f4efff] dark:bg-white/10">
                <CopilotKitMark className="h-6 w-6" />
              </div>
              <div>
                <div className="text-sm font-semibold">CopilotKit</div>
                <div className="text-xs text-[#6b6f76] dark:text-white/55">
                  New look and feel
                </div>
              </div>
            </div>
            <div className="flex h-7 items-center gap-1 rounded-full bg-[#eef8f3] px-2 text-xs font-medium text-[#14794f] dark:bg-[#1b3a2d] dark:text-[#8de0b4]">
              <Sparkles className="h-3.5 w-3.5" />
              Ready
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto bg-[#fbfafc] px-4 py-4 dark:bg-[#111318]">
            <div className="max-w-[82%] rounded-2xl rounded-tl-md border border-[#e6e0ef] bg-white px-4 py-3 text-sm shadow-sm dark:border-white/10 dark:bg-[#20232b]">
              Hey there. Let&apos;s have a fun conversation.
            </div>

            <div className="ml-auto max-w-[78%] rounded-2xl rounded-tr-md bg-[#5b2ca0] px-4 py-3 text-sm text-white shadow-sm">
              What changed in 1.8.2?
            </div>

            <div className="max-w-[88%] rounded-2xl rounded-tl-md border border-[#e6e0ef] bg-white px-4 py-3 text-sm shadow-sm dark:border-white/10 dark:bg-[#20232b]">
              The chat UI has refreshed styling, first-class feedback actions,
              and built-in dark mode support.
              <div className="mt-3 flex items-center gap-1.5 text-[#6b6f76] dark:text-white/55">
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
                  className="rounded-full border border-[#dfd7ef] bg-white px-3 py-2 text-left text-xs font-medium text-[#4f2c86] transition hover:border-[#bfa9e3] hover:bg-[#f6f1ff] dark:border-white/10 dark:bg-white/5 dark:text-[#d8c8ff] dark:hover:bg-white/10"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-[#ece7f6] bg-white p-3 dark:border-white/10 dark:bg-[#17191f]">
            <div className="flex items-center gap-2 rounded-2xl border border-[#ded8ed] bg-[#fbfafc] px-3 py-2 dark:border-white/10 dark:bg-white/5">
              <input
                readOnly
                value="Ask anything..."
                aria-label="Preview chat input"
                className="min-w-0 flex-1 bg-transparent text-sm text-[#6b6f76] outline-none dark:text-white/55"
              />
              <button
                type="button"
                aria-label="Send preview message"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#5b2ca0] text-white transition hover:bg-[#4b2387]"
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
      className="flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-[#f1edf8] hover:text-[#4f2c86] dark:hover:bg-white/10 dark:hover:text-white"
    >
      {children}
    </button>
  );
}

"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Copies `text` and shows a check for a moment. */
export function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          })
          // Clipboard access denied: no check mark, so the button reads as not copied.
          .catch(() => {});
      }}
      className={cn(
        "flex size-8 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground",
        className,
      )}
    >
      {copied ? (
        <Check className="size-4 text-emerald-400" />
      ) : (
        <Copy className="size-4" />
      )}
    </button>
  );
}

"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyText } from "@/lib/copy-text";
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
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      onClick={() => {
        // When neither copy path works, no check mark, so the button reads as not copied.
        void copyText(text).then((ok) => {
          setCopied(ok);
          if (!ok) return;
          // A second copy restarts the window instead of being cut short by the first one's timer.
          clearTimeout(reset.current);
          reset.current = setTimeout(() => setCopied(false), 1400);
        });
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

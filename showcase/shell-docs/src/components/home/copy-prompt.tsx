"use client";

import Image from "next/image";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useStack } from "@/components/stack/stack-provider";
import { backendById, frontendById } from "@/lib/stack";

/**
 * copilotkit.ai's "Copy Prompt" control: copies a setup prompt for a coding
 * agent, scoped to the reader's stack when they have chosen one.
 */
export function CopyPrompt() {
  const { stack } = useStack();
  const [copied, setCopied] = useState(false);

  function prompt() {
    const origin = window.location.origin;
    const target = stack
      ? ` for ${frontendById(stack.frontend)?.name} with ${backendById(stack.backend)?.name}`
      : "";
    return [
      `Add CopilotKit to this project${target}.`,
      `Follow ${origin}/docs/quickstart.md step by step and run the app when you're done.`,
    ].join("\n");
  }

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(prompt());
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className="inline-flex h-11 items-center gap-2.5 rounded-full border bg-fd-background px-4 font-mono text-sm font-medium transition-colors hover:bg-fd-accent focus-visible:ring-2 focus-visible:ring-fd-ring focus-visible:outline-none"
    >
      {copied ? (
        <Check className="size-4 text-fd-primary" aria-hidden="true" />
      ) : (
        <Copy className="size-4 text-fd-muted-foreground" aria-hidden="true" />
      )}
      <span aria-live="polite">{copied ? "Copied" : "Copy prompt"}</span>
      <span className="h-5 w-px bg-fd-border" aria-hidden="true" />
      {/* Says the prompt is for a coding agent; the logos open nothing. */}
      <span className="flex items-center gap-1.5" aria-hidden="true">
        <Image
          unoptimized
          src="/images/prompt-claude.webp"
          alt=""
          width={18}
          height={18}
        />
        <Image
          unoptimized
          src="/images/prompt-codex.webp"
          alt=""
          width={18}
          height={18}
        />
      </span>
    </button>
  );
}

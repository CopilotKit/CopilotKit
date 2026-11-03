"use client";

import Image from "next/image";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { frameworkById, frontendById } from "./data";
import { useFrontend } from "./frontend";
import { useLastFramework } from "./last-framework";
import { frameworkHref } from "./routes";

/**
 * copilotkit.ai's "Copy prompt" pill: a setup prompt for a coding agent,
 * scoped to the reader's frontend and agent framework.
 */
export function CopyPromptD() {
  const { frontend } = useFrontend();
  const [framework] = useLastFramework();
  const [copied, setCopied] = useState(false);

  async function copy() {
    const fe = frontendById(frontend)?.name ?? "React";
    const fw = frameworkById(framework)?.name ?? "CopilotKit";
    const url = `${window.location.origin}${frameworkHref("d", framework, "quickstart")}`;
    await navigator.clipboard.writeText(
      `Add CopilotKit to this ${fe} project with ${fw}.\nFollow ${url} step by step, then run the app.`,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <Button
      variant="outline"
      onClick={copy}
      className="h-11 gap-2.5 rounded-full bg-card px-4 font-mono shadow-lift"
    >
      {copied ? (
        <Check className="text-primary" aria-hidden="true" />
      ) : (
        <Copy className="text-muted-foreground" aria-hidden="true" />
      )}
      <span aria-live="polite">{copied ? "Copied" : "Copy prompt"}</span>
      <span className="h-5 w-px bg-border" aria-hidden="true" />
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
    </Button>
  );
}

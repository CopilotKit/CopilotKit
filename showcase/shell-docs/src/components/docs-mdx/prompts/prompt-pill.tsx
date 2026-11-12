"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Eye } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { PROMPT_DESTINATION_HINT, PROMPT_PHONE_HINT } from "./onboarding";

export type PromptAction = "copy" | "view_prompt" | "copy_preview";

export interface PromptPayload {
  text: string;
  onCopied?: (action: PromptAction) => void;
  onAction?: (action: PromptAction) => void;
}

/**
 * Where the prompt goes, under every prompt pill. A phone gets the other
 * line: the prompt runs in a coding agent on a computer (PE-339).
 */
export function PromptGuidance() {
  return (
    <p className="text-sm leading-snug text-muted-foreground">
      <span className="max-sm:pointer-coarse:hidden">
        {PROMPT_DESTINATION_HINT}
      </span>
      <span className="hidden max-sm:pointer-coarse:inline">
        {PROMPT_PHONE_HINT}
      </span>
    </p>
  );
}

/**
 * copilotkit.ai's "Copy prompt" pill (the white mono pill with the Claude and
 * Codex marks), the site's one hand-off to a coding agent, with shell-docs'
 * behavior: each click builds a fresh payload, "View prompt" shows exactly
 * what would be copied, and a blocked clipboard opens it for manual copying.
 * Analytics run through the payload's callbacks and never block the copy.
 */
export function PromptPill({
  createPrompt,
  surface,
  viewPrompt = true,
  compact = false,
  disabled = false,
}: {
  /** The prompt, built on each click; `null` when there's nothing to copy yet. */
  createPrompt: () => PromptPayload | null;
  /** Analytics surface; also read by the global copy tracker. */
  surface?: string;
  /**
   * Show "View prompt" beside the pill. Without it, the prompt opens only
   * when the clipboard is blocked, anchored to the pill.
   */
  viewPrompt?: boolean;
  /** The smaller pill, for a toolbar. */
  compact?: boolean;
  disabled?: boolean;
}) {
  const pill = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<PromptPayload | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function record(payload: PromptPayload, action: PromptAction) {
    try {
      payload.onAction?.(action);
    } catch {
      // Analytics must not break onboarding.
    }
  }

  async function copy(payload: PromptPayload, action: PromptAction) {
    record(payload, action);
    setBusy(true);
    setCopied(false);
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(payload.text);
      try {
        payload.onCopied?.(action);
      } catch {
        // Analytics cannot break copy.
      }
      setCopied(true);
      setMessage("Prompt copied");
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setMessage("Copy blocked. Select and copy the prompt below.");
      setPreview(payload);
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="not-prose flex flex-wrap items-center gap-2"
      data-docs-copy-surface={surface}
    >
      <Button
        ref={pill}
        variant="outline"
        disabled={disabled || busy}
        data-surface={surface}
        data-docs-copy-surface={surface}
        onClick={() => {
          const payload = createPrompt();
          if (payload) void copy(payload, "copy");
        }}
        className={cn(
          "gap-2.5 rounded-full bg-card font-mono shadow-lift",
          compact ? "h-8 gap-2 px-3 text-xs max-md:h-10" : "h-11 px-4",
        )}
      >
        {copied ? (
          <Check className="text-primary" aria-hidden="true" />
        ) : (
          <Copy className="text-muted-foreground" aria-hidden="true" />
        )}
        <span>{copied ? "Copied" : "Copy prompt"}</span>
        <span
          className={cn("w-px bg-border", compact ? "h-4" : "h-5")}
          aria-hidden="true"
        />
        {/* Says the prompt is for a coding agent; the marks open nothing. */}
        <span className="flex items-center gap-1.5" aria-hidden="true">
          {["claude", "codex"].map((mark) => (
            <Image
              key={mark}
              unoptimized
              src={`/images/prompt-${mark}.webp`}
              alt=""
              width={compact ? 16 : 18}
              height={compact ? 16 : 18}
            />
          ))}
        </span>
      </Button>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) {
            const payload = createPrompt();
            if (!payload) return;
            record(payload, "view_prompt");
            setPreview(payload);
            setMessage("");
          }
          setOpen(next);
        }}
      >
        {viewPrompt ? (
          <PopoverTrigger
            className={cn(
              buttonVariants({ variant: "ghost" }),
              "h-11 gap-2 rounded-full px-4 font-mono text-muted-foreground",
            )}
          >
            <Eye aria-hidden="true" />
            View prompt
          </PopoverTrigger>
        ) : null}
        <PopoverContent
          align="start"
          anchor={viewPrompt ? undefined : pill}
          className="w-[min(32rem,calc(100vw-2rem))] gap-3 p-3"
        >
          <PopoverHeader>
            <PopoverTitle>Agent prompt</PopoverTitle>
          </PopoverHeader>
          <Textarea
            aria-label="Agent prompt"
            readOnly
            value={preview?.text ?? ""}
            onFocus={(event) => event.currentTarget.select()}
            className="max-h-64 font-mono text-xs leading-relaxed md:text-xs"
          />
          {message.startsWith("Copy blocked") ? (
            <p className="text-xs text-muted-foreground">{message}</p>
          ) : null}
          <Button
            disabled={busy || !preview}
            data-docs-copy-surface={surface}
            onClick={() => preview && copy(preview, "copy_preview")}
            className="h-9 self-start rounded-full bg-foreground px-4 font-mono text-xs text-background hover:bg-foreground/85"
          >
            Copy displayed prompt
          </Button>
        </PopoverContent>
      </Popover>
      <span role="status" className="sr-only">
        {message}
      </span>
    </div>
  );
}

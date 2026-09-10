"use client";

import Image from "next/image";
import React, { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, FileText, X } from "lucide-react";
import type { PromptApp } from "@/lib/launch-prompt";
import { launchPrompt } from "@/lib/launch-prompt";
import "./prompt-pill.css";

export interface PromptPayload {
  text: string;
  onCopied?: () => void;
}

/** Compact prompt actions shared by docs hero and page tools. */
export function PromptPill({
  createPrompt,
  surface,
  children,
  ...props
}: {
  createPrompt: () => PromptPayload;
  surface?: string;
} & React.ComponentProps<"button">): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<PromptPayload | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const mounted = useRef(true);
  const titleId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (preview) dialog.current?.showModal();
  }, [preview]);

  /** Preserve the exact displayed payload for manual copy and retry. */
  function showPrompt(payload: PromptPayload): void {
    trigger.current = document.activeElement as HTMLElement;
    setPreview(payload);
  }

  /** Return focus to the action that opened the native modal. */
  function closePrompt(): void {
    dialog.current?.close();
    setPreview(null);
    trigger.current?.focus();
  }

  /** Copy once; a denied clipboard leaves selectable text available. */
  async function copy(payload: PromptPayload): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    const current = ++generation.current;
    if (timer.current) clearTimeout(timer.current);
    setCopied(false);
    try {
      await navigator.clipboard.writeText(payload.text);
      try {
        payload.onCopied?.();
      } catch {
        /* Analytics cannot break copy. */
      }
      if (!mounted.current || current !== generation.current) return;
      setCopied(true);
      setMessage("Prompt copied");
      timer.current = setTimeout(() => {
        if (mounted.current && current === generation.current) setCopied(false);
      }, 1600);
    } catch {
      if (!mounted.current || current !== generation.current) return;
      setMessage("Copy blocked. Select and copy the prompt below.");
      showPrompt(payload);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  /** Dispatch before any asynchronous clipboard operation loses activation. */
  function openApp(app: PromptApp): void {
    const payload = createPrompt();
    if (app === "claude" && payload.text.length > 5000) {
      setMessage(
        "This prompt is too long for the Claude app link. Copy it below.",
      );
      showPrompt(payload);
      return;
    }
    try {
      launchPrompt(app, payload.text);
      setMessage(
        `${app === "claude" ? "Claude" : "Codex"} launch requested. If it did not open, copy the prompt.`,
      );
    } catch {
      setMessage("The app link could not open. Copy the prompt below.");
      showPrompt(payload);
    }
    copy(payload);
  }

  return (
    <div className="prompt-pill" data-docs-copy-surface={surface}>
      <div className="prompt-pill-dock" role="group" aria-label="Agent prompt">
        <button
          {...props}
          type="button"
          data-surface={surface}
          data-docs-copy-surface={surface}
          className="prompt-pill-copy"
          aria-label={typeof children === "string" ? children : "Copy prompt"}
          disabled={busy || props.disabled}
          onClick={() => copy(createPrompt())}
        >
          {copied ? (
            <Check className="prompt-pill-check" aria-hidden="true" />
          ) : (
            <Copy aria-hidden="true" />
          )}
          <span>COPY PROMPT</span>
        </button>
        <span className="prompt-pill-divider" aria-hidden="true" />
        <button
          type="button"
          className="prompt-pill-app"
          aria-label="Open in Claude Code"
          title="Open in Claude Code"
          onClick={() => openApp("claude")}
        >
          <Image
            unoptimized
            src="/images/prompt-claude.webp"
            alt=""
            width={18}
            height={18}
          />
        </button>
        <button
          type="button"
          className="prompt-pill-app"
          aria-label="Open in Codex"
          title="Open in Codex"
          onClick={() => openApp("codex")}
        >
          <Image
            unoptimized
            src="/images/prompt-codex.webp"
            alt=""
            width={18}
            height={18}
          />
        </button>
      </div>
      <div className="prompt-pill-shelf">
        <button type="button" onClick={() => showPrompt(createPrompt())}>
          <FileText aria-hidden="true" />
          View prompt
        </button>
      </div>
      <span role="status" className="sr-only">
        {message}
      </span>
      {preview && (
        <dialog
          ref={dialog}
          className="prompt-pill-dialog"
          aria-labelledby={titleId}
          onCancel={closePrompt}
        >
          <div className="prompt-pill-dialog-heading">
            <h2 id={titleId}>Agent prompt</h2>
            <button
              type="button"
              aria-label="Close prompt"
              onClick={closePrompt}
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <textarea
            aria-label="Agent prompt"
            readOnly
            value={preview.text}
            onFocus={(event) => event.currentTarget.select()}
          />
          <p>
            {message.startsWith("Copy blocked") ||
            message.startsWith("This prompt")
              ? message
              : ""}
          </p>
          <button
            type="button"
            className="prompt-pill-dialog-copy"
            disabled={busy}
            onClick={() => copy(preview)}
          >
            Copy displayed prompt
          </button>
        </dialog>
      )}
    </div>
  );
}

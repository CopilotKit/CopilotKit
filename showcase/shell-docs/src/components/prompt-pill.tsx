"use client";

import Image from "next/image";
import React, { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, Eye, X } from "lucide-react";
import {
  PROMPT_DESTINATION_HINT,
  PROMPT_PHONE_HINT,
} from "@/lib/prompt-guidance";
import "./prompt-pill.css";

export type PromptAction = "copy" | "view_prompt" | "copy_preview";

export interface PromptPayload {
  text: string;
  onCopied?: (action: PromptAction) => void;
  onAction?: (action: PromptAction) => void;
}

/**
 * Where the prompt goes. Both variants render, and CSS shows the phone one on a
 * small touch screen, so the server and the first client render agree.
 */
export function PromptGuidance({
  className = "",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <p className={`prompt-guidance ${className}`.trim()}>
      <span className="prompt-guidance-desktop">{PROMPT_DESTINATION_HINT}</span>
      <span className="prompt-guidance-phone">{PROMPT_PHONE_HINT}</span>
    </p>
  );
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
  const pending = useRef<PromptPayload | null>(null);
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
  async function copy(
    payload: PromptPayload,
    action: PromptAction,
  ): Promise<boolean> {
    if (pending.current) return false;
    pending.current = payload;
    setBusy(true);
    const current = ++generation.current;
    if (timer.current) clearTimeout(timer.current);
    setCopied(false);
    try {
      await navigator.clipboard.writeText(payload.text);
      try {
        payload.onCopied?.(action);
      } catch {
        /* Analytics cannot break copy. */
      }
      if (!mounted.current || current !== generation.current) return false;
      setCopied(true);
      setMessage("Prompt copied");
      timer.current = setTimeout(() => {
        if (mounted.current && current === generation.current) setCopied(false);
      }, 1600);
      return true;
    } catch {
      if (!mounted.current || current !== generation.current) return false;
      setMessage("Copy blocked. Select and copy the prompt below.");
      showPrompt(payload);
      return false;
    } finally {
      pending.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  /** Record direct user intent without letting analytics block the action. */
  function recordAction(payload: PromptPayload, action: PromptAction): void {
    try {
      payload.onAction?.(action);
    } catch {
      /* Analytics must not break onboarding. */
    }
  }

  /** Copy from a direct control. */
  function copyFromControl(
    payload: PromptPayload,
    action: "copy" | "copy_preview",
  ): void {
    recordAction(payload, action);
    copy(payload, action);
  }

  /** Show exactly the payload associated with this preview action. */
  function viewPrompt(): void {
    const payload = createPrompt();
    recordAction(payload, "view_prompt");
    showPrompt(payload);
  }

  return (
    <div className="prompt-pill not-prose" data-docs-copy-surface={surface}>
      <div className="prompt-pill-dock" role="group" aria-label="Agent prompt">
        <button
          {...props}
          type="button"
          data-surface={surface}
          data-docs-copy-surface={surface}
          className="prompt-pill-copy"
          aria-label={typeof children === "string" ? children : "Copy prompt"}
          disabled={busy || props.disabled}
          onClick={() => copyFromControl(createPrompt(), "copy")}
        >
          {copied ? (
            <Check className="prompt-pill-check" aria-hidden="true" />
          ) : (
            <Copy aria-hidden="true" />
          )}
          <span>Copy Prompt</span>
          {/* Say that the prompt belongs in a coding agent. Decoration only:
              the logos open nothing, and a click on them copies (PE-381). */}
          <span className="prompt-pill-logos" aria-hidden="true">
            <span className="prompt-pill-divider" />
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
        {/* A touch screen cannot hover to reveal the shelf, so View prompt
            sits in the pill, as on the Intelligence Home. CSS shows this or
            the shelf from the first paint; only one is ever displayed. */}
        <button
          type="button"
          className="prompt-pill-view"
          aria-label="View prompt"
          title="View prompt"
          onClick={viewPrompt}
        >
          <Eye aria-hidden="true" />
        </button>
      </div>
      <div className="prompt-pill-shelf">
        <button type="button" onClick={viewPrompt}>
          <Eye aria-hidden="true" />
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
          <p>{message.startsWith("Copy blocked") ? message : ""}</p>
          <button
            type="button"
            className="prompt-pill-dialog-copy"
            disabled={busy}
            onClick={() => copyFromControl(preview, "copy_preview")}
          >
            Copy displayed prompt
          </button>
        </dialog>
      )}
    </div>
  );
}

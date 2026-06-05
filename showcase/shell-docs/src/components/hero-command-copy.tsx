"use client";

import React from "react";
import { Check, Copy } from "lucide-react";

type CopyState = "idle" | "copied" | "selected" | "error";

function selectCommandText(sourceElement: HTMLElement | null) {
  if (!sourceElement) return false;

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(sourceElement);
  selection?.removeAllRanges();
  selection?.addRange(range);

  return true;
}

function copySelectedText() {
  const copied = document.execCommand("copy");

  if (copied) {
    window.getSelection()?.removeAllRanges();
  }

  return copied;
}

async function copyCommand(command: string, sourceElement: HTMLElement | null) {
  if (selectCommandText(sourceElement)) {
    if (copySelectedText()) {
      return;
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = command;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, command.length);
  const copied = copySelectedText();
  document.body.removeChild(textarea);

  if (copied) {
    return;
  }

  if (navigator.clipboard?.writeText) {
    try {
      await Promise.race([
        navigator.clipboard.writeText(command),
        new Promise((_, reject) => {
          window.setTimeout(
            () => reject(new Error("navigator.clipboard.writeText timed out")),
            350,
          );
        }),
      ]);
      return;
    } catch {
      // Fall through to the shared failure below.
    }
  }

  throw new Error("Copy command failed");
}

export function HeroCommandCopy({ command }: { command: string }) {
  const [state, setState] = React.useState<CopyState>("idle");
  const commandRef = React.useRef<HTMLElement | null>(null);
  const resetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  React.useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const copied = state === "copied";
  const selected = state === "selected";
  const error = state === "error";

  return (
    <button
      type="button"
      aria-label={
        copied
          ? "Copied command"
          : selected
            ? "Command selected"
            : "Copy command"
      }
      className="shell-docs-radius-control group flex h-11 min-w-0 items-center gap-3 border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-left transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)]"
      onClick={async () => {
        if (resetTimerRef.current) {
          clearTimeout(resetTimerRef.current);
          resetTimerRef.current = null;
        }

        try {
          await copyCommand(command, commandRef.current);
          setState("copied");
          resetTimerRef.current = setTimeout(() => setState("idle"), 1500);
        } catch (err) {
          console.warn("[hero-command-copy] clipboard write failed", err);
          if (selectCommandText(commandRef.current)) {
            setState("selected");
            resetTimerRef.current = setTimeout(() => {
              window.getSelection()?.removeAllRanges();
              setState("idle");
            }, 2500);
          } else {
            setState("error");
            resetTimerRef.current = setTimeout(() => setState("idle"), 2000);
          }
        }
      }}
    >
      <code className="min-w-0 overflow-x-auto whitespace-nowrap font-mono text-[13px] text-[var(--text-secondary)]">
        <span ref={commandRef}>{command}</span>
      </code>
      <span
        className="shell-docs-radius-icon inline-flex h-7 w-7 shrink-0 items-center justify-center border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] transition-colors group-hover:text-[var(--accent)]"
        aria-hidden="true"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </span>
      <span className="sr-only" aria-live="polite">
        {copied
          ? "Copied"
          : selected
            ? "Command selected"
            : error
              ? "Copy failed"
              : "Copy command"}
      </span>
    </button>
  );
}

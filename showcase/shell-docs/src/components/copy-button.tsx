// <CopyButton> — minimal clipboard button used by <Snippet>.
// Lives on the client so it can access navigator.clipboard.

"use client";

import React, { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "error";

export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<CopyState>("idle");
  // Track the pending reset timer so we can clear it on unmount (avoids the
  // React 18 "state update on an unmounted component" warning) and also
  // overwrite a stale timer when the user clicks again before it fires.
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const copied = state === "copied";
  const error = state === "error";

  let label: string;
  if (copied) label = "Copied";
  else if (error) label = "Copy blocked";
  else label = "Copy";

  return (
    <button
      type="button"
      onClick={async (e) => {
        e.preventDefault();
        // Clear any in-flight reset from a previous click so rapid-fire copies
        // don't race each other and flip the label back early.
        if (resetTimerRef.current) {
          clearTimeout(resetTimerRef.current);
          resetTimerRef.current = null;
        }
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
          resetTimerRef.current = setTimeout(() => setState("idle"), 1500);
        } catch (err) {
          // Clipboard blocked (permissions, insecure context, etc.) — surface
          // the failure to the user so they know the button didn't work, and
          // log enough for devs to debug rather than silently swallowing.
          console.warn("[copy-button] clipboard write failed", err);
          setState("error");
          resetTimerRef.current = setTimeout(() => setState("idle"), 2000);
        }
      }}
      aria-label={label}
      style={{
        padding: "2px 8px",
        fontSize: "10px",
        lineHeight: 1.2,
        border: "1px solid var(--border)",
        borderRadius: "4px",
        background: copied
          ? "var(--accent-light)"
          : error
            ? "var(--bg-elevated)"
            : "var(--bg-surface)",
        color: copied
          ? "var(--accent)"
          : error
            ? "var(--text)"
            : "var(--text-muted)",
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "background 120ms, color 120ms",
      }}
    >
      {label}
    </button>
  );
}

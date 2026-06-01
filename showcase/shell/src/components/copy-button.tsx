// <CopyButton> — minimal clipboard button used by <Snippet>.
// Lives on the client so it can access navigator.clipboard.

"use client";

import React, { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async (e) => {
        e.preventDefault();
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // noop — clipboard blocked by browser
        }
      }}
      aria-label={copied ? "Copied" : "Copy code"}
      style={{
        padding: "2px 8px",
        fontSize: "10px",
        lineHeight: 1.2,
        border: "1px solid var(--border)",
        borderRadius: "4px",
        background: copied ? "var(--accent-light)" : "var(--bg-surface)",
        color: copied ? "var(--accent)" : "var(--text-muted)",
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "background 120ms, color 120ms",
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

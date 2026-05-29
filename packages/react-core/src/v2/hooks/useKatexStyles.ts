"use client";

import { useEffect } from "react";

let injected = false;

/**
 * Returns true if `text` plausibly contains LaTeX math that KaTeX would render:
 * `$…$` / `$$…$$` (remark-math) or `\(…\)`, `\[…\]`, `\begin{…}`. Deliberately
 * errs toward true (e.g. "$5 and $10" matches) — a spurious style load is cheap,
 * but failing to load when math IS present would render it unformatted.
 */
export function containsMath(text: string): boolean {
  if (!text) return false;
  return /\$\$?[\s\S]+?\$\$?/.test(text) || /\\\(|\\\[|\\begin\{/.test(text);
}

/**
 * Dynamically injects KaTeX CSS at runtime — only when the message content
 * actually contains math — to avoid both the Next.js "Global CSS cannot be
 * imported from within node_modules" build error and loading ~76 kB of KaTeX
 * CSS on every assistant message that has no math.
 *
 * Pass the message content to gate on math; called with no argument it loads
 * unconditionally (legacy behavior). A singleton flag injects the sheet once.
 */
export function useKatexStyles(content?: string): void {
  const hasMath = content === undefined ? true : containsMath(content);

  useEffect(() => {
    if (!hasMath || injected || typeof document === "undefined") return;
    injected = true;

    // Dynamic import defers CSS loading to runtime, bypassing Next.js static
    // analysis that rejects global CSS from node_modules.
    void import("katex/dist/katex.min.css").catch(() => {
      console.warn(
        "[CopilotKit] Failed to load katex styles — math content may render without formatting",
      );
    });
  }, [hasMath]);
}

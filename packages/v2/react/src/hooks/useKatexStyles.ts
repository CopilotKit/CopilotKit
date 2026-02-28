"use client";

import { useEffect } from "react";

let injected = false;

/**
 * Dynamically injects KaTeX CSS at runtime to avoid the Next.js
 * "Global CSS cannot be imported from within node_modules" build error.
 *
 * Uses a singleton flag so the stylesheet is only injected once.
 */
export function useKatexStyles(): void {
  useEffect(() => {
    if (injected || typeof document === "undefined") return;
    injected = true;

    // Dynamic import defers CSS loading to runtime, bypassing
    // Next.js static analysis that rejects global CSS from node_modules.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    void import("katex/dist/katex.min.css").catch(() => {
      // Silently ignore — consumers can import KaTeX CSS manually
    });
  }, []);
}

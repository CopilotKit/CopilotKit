import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { PixelMatrix } from "./pixel-matrix";

/**
 * The ground every pixel matrix sits on: the website's use-case preview
 * lilac (--demo-stage). With PixelMatrix's tokens, this is the one place the
 * matrix's look comes from.
 */
export const MATRIX_GROUND = "bg-(image:--demo-stage)";

/**
 * Command snippets (an `npm install`, a shell session) sit on a compact
 * stage: the same frame, drawn tighter, since they're one line to copy.
 */
const COMMAND_LANGS = new Set([
  "bash",
  "sh",
  "shell",
  "shellscript",
  "shellsession",
  "zsh",
  "console",
  "powershell",
  "ps1",
  "cmd",
  "bat",
]);

export function isCommandLang(lang?: string) {
  return !!lang && COMMAND_LANGS.has(lang.toLowerCase());
}

/**
 * The website's demo stage: the lilac use-case preview ground (--demo-stage)
 * with its white rim and broad shadow, carrying the white pixel matrix, lit
 * under the pointer. What it holds (a demo window, a code block) sits on it
 * as a white window. Used by DemoFrame and every code block.
 */
export function Stage({
  children,
  compact = false,
  className,
}: {
  /** A tighter frame: 6 to 8px of matrix around the window. */
  compact?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "not-prose relative isolate overflow-hidden rounded-[20px] border-[1.5px] border-stage-rim shadow-lift-stage",
        compact ? "p-1.5 sm:p-2" : "p-2.5 sm:p-6",
        MATRIX_GROUND,
        className,
      )}
    >
      <PixelMatrix interactive />
      {children}
    </div>
  );
}

/** The white window on a stage: its rim and lift, shared by demos and code. */
export const STAGE_WINDOW =
  "rounded-xl border border-white/80 shadow-[0_24px_48px_rgb(31_38_36/0.14)] dark:border-white/10";

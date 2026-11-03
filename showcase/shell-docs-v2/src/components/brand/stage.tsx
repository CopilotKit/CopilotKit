import { Children, isValidElement, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { PixelMatrix } from "./pixel-matrix";

/**
 * The ground every pixel matrix sits on: the website's blue protocol-map
 * stage (--stage), as behind the home diagram. With PixelMatrix's tokens,
 * this is the one place the matrix's look comes from.
 */
export const MATRIX_GROUND = "bg-(image:--stage)";

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
 * The demo stage: the blue protocol-map ground (--stage) with its white rim and broad shadow, carrying the white pixel matrix, lit
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

/**
 * Classes that make a Fumadocs tab group of code the stage's window: the
 * tabs are the window's bar, like a code block's title bar, with the active
 * block under them. (Here, not in the client staged-code.tsx, so server
 * components can read it.)
 */
export const CODE_TABS_WINDOW = cn(
  "my-0 overflow-hidden bg-fd-background [&>[role=tablist]]:h-9.5 [&>[role=tablist]]:items-center [&>[role=tablist]]:border-b [&>[role=tabpanel]]:rounded-none [&>[role=tabpanel]]:p-0 [&>[role=tabpanel]>figure]:m-0!",
  STAGE_WINDOW,
);

/**
 * An untitled code block's viewport: it ends short of the copy button that
 * floats at its top right, so the button never sits on the code.
 */
export const UNTITLED_VIEWPORT = { className: "me-10" };

/**
 * A code fence's language, from the `language-xxx` class rehype-code puts on
 * its `<code>`. Read on the server: a client component only sees the fence's
 * children as rendered output.
 */
export function fenceLang(children: ReactNode) {
  if (!isValidElement<{ className?: unknown }>(children)) return undefined;
  const { className } = children.props;
  return typeof className === "string"
    ? /language-(\S+)/.exec(className)?.[1]
    : undefined;
}

/**
 * Whether a tab group of code holds only commands (`npm install` in each
 * package manager, say), so it takes the compact stage too. Walks the
 * group's elements on the server for their fences' languages.
 */
export function commandsOnly(children: ReactNode) {
  const langs: string[] = [];
  const walk = (node: ReactNode, depth: number) => {
    if (depth > 6) return;
    Children.forEach(node, (child) => {
      if (!isValidElement<{ className?: unknown; children?: ReactNode }>(child))
        return;
      const { className } = child.props;
      const lang =
        typeof className === "string"
          ? /language-(\S+)/.exec(className)?.[1]
          : undefined;
      if (lang) langs.push(lang);
      else walk(child.props.children, depth + 1);
    });
  };
  walk(children, 0);
  return langs.length > 0 && langs.every((lang) => isCommandLang(lang));
}

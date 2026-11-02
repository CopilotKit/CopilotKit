"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";
import { useDesignSystem } from "@/design-systems/context";
import { DESIGN_SYSTEMS } from "@/design-systems/registry";
import { copyText } from "@/lib/copy-text";
import { cn } from "@/lib/utils";
import { CodeBlock, CommandLine } from "./code-block";
import { buildPrompt, PROVIDER_LINE, UI_NOTE } from "./prompt";
import { INSTALL } from "./snippets";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.72_0.17_292/60%)]";

/**
 * The Get started call to action: pick the design system the app draws with, copy one prompt for a coding
 * agent, and see the two lines it comes down to. The pick is the playground's too.
 */
export function CopyPrompt() {
  const { id, setId } = useDesignSystem();
  // The prompt links this site; its address is known in the browser only.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const prompt = buildPrompt(id, origin);

  const [copied, setCopied] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
  const copy = () => {
    void copyText(buildPrompt(id, window.location.origin)).then((ok) => {
      setCopied(ok);
      if (!ok) return;
      clearTimeout(reset.current);
      reset.current = setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className="flex flex-col gap-10">
      <div className="rounded-2xl border border-border bg-[#0b0b0d] p-5 sm:p-7">
        <div
          role="radiogroup"
          aria-label="Design system"
          className="grid gap-2 sm:grid-cols-3"
          onKeyDown={(e) => {
            // A radio group is one tab stop; the arrow keys move the choice, as with native radios.
            const step =
              e.key === "ArrowRight" || e.key === "ArrowDown"
                ? 1
                : e.key === "ArrowLeft" || e.key === "ArrowUp"
                  ? -1
                  : 0;
            if (!step) return;
            e.preventDefault();
            const at = DESIGN_SYSTEMS.findIndex((d) => d.id === id);
            const next =
              DESIGN_SYSTEMS[
                (at + step + DESIGN_SYSTEMS.length) % DESIGN_SYSTEMS.length
              ];
            setId(next.id);
            e.currentTarget
              .querySelector<HTMLElement>(
                `[data-start-design-system="${next.id}"]`,
              )
              ?.focus();
          }}
        >
          {DESIGN_SYSTEMS.map((d) => {
            const on = d.id === id;
            return (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                data-start-design-system={d.id}
                onClick={() => setId(d.id)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left transition-colors",
                  on
                    ? "border-[oklch(1_0_0/28%)] bg-white/[0.05]"
                    : "border-border hover:border-[oklch(1_0_0/16%)] hover:bg-white/[0.025]",
                  focusRing,
                )}
              >
                <span className="flex w-full items-center justify-between gap-2 text-[14.5px] font-medium text-foreground">
                  {d.label}
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-4 place-items-center rounded-full border",
                      on
                        ? "border-foreground bg-foreground"
                        : "border-[oklch(1_0_0/22%)]",
                    )}
                  >
                    {on ? (
                      <span className="size-1.5 rounded-full bg-background" />
                    ) : null}
                  </span>
                </span>
                <span className="text-[12.5px] leading-snug text-muted-foreground">
                  {d.note}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
          <button
            type="button"
            onClick={copy}
            data-copy-prompt
            className={cn(
              "inline-flex h-11 items-center gap-2 rounded-lg bg-foreground px-5 text-[15px] font-semibold text-background transition-opacity hover:opacity-90",
              focusRing,
            )}
          >
            {copied ? (
              <Check className="size-4" aria-hidden />
            ) : (
              <Copy className="size-4" aria-hidden />
            )}
            {copied ? "Copied" : "Copy prompt"}
          </button>
          <p className="text-[14px] leading-snug text-muted-foreground">
            Paste it into Claude Code, Cursor, Gemini CLI or Codex, in your
            app&apos;s repository.
          </p>
          <span role="status" className="sr-only">
            {copied ? "Prompt copied" : ""}
          </span>
        </div>

        <details className="group mt-6 border-t border-border pt-4">
          <summary
            className={cn(
              "inline-flex cursor-pointer list-none items-center gap-1.5 rounded-sm text-[13.5px] text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden",
              focusRing,
            )}
          >
            <ChevronRight
              className="size-4 transition-transform group-open:rotate-90"
              aria-hidden
            />
            Read the prompt
          </summary>
          <pre className="mt-4 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-black/40 p-4 font-mono text-[12.5px] leading-[1.65] text-[oklch(0.85_0.005_285)]">
            {prompt}
          </pre>
        </details>
      </div>

      <div>
        <h2 className="text-[18px] font-semibold tracking-tight">
          Or by hand, in two lines
        </h2>
        <p className="mt-2 max-w-[66ch] text-[14.5px] leading-relaxed text-muted-foreground">
          Install CopilotKit, then give the provider your catalog. The runtime
          route that runs the agent is one file; the prompt adds it for you.
        </p>
        <div className="mt-5 flex max-w-[820px] flex-col gap-3">
          <CommandLine command={INSTALL} />
          <CodeBlock code={PROVIDER_LINE} file="app/layout.tsx" />
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {UI_NOTE[id]}
          </p>
        </div>
      </div>
    </div>
  );
}

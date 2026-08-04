"use client";

// <ChannelsStartPrompt> — the Channels overview page's road into onboarding.
//
// Every Channels surface (this page, the docs landing activation strip,
// copilotkit.ai/channels, the channels-sdk README) points at the same skill
// with the same two sentences. They used to carry the workflow inline instead:
// six copies across three repos, which drifted apart and went stale against the
// CLI, so developers were told to run commands that no longer existed.
//
// The text is rendered, not just copied. The prompts this replaced were hidden
// behind an accordion because they were twenty lines long; at one line there is
// nothing to hide, and a copy button whose payload is invisible reads as
// decoration.

import React from "react";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { Copy, SquareTerminal } from "lucide-react";
import {
  CHANNELS_ACTIVATION_EVENTS,
  buildChannelsActivationPrompt,
  buildChannelsActivationPromptParts,
} from "@/lib/channels-activation-contracts";
import type { ChannelsActivationChannelId } from "@/lib/channels-activation-contracts";

type CopyState = "idle" | "copied" | "error";

export interface ChannelsStartPromptProps {
  /** Injected from the page's docs frontend by the MDX component map. */
  frontend?: string;
  /** Backend label to name in the prompt. Defaults to the built-in agent. */
  backendLabel?: string;
}

const CHANNEL_LABELS: Record<ChannelsActivationChannelId, string> = {
  slack: "Slack",
  teams: "Microsoft Teams",
};

export function ChannelsStartPrompt({
  frontend,
  backendLabel = "CopilotKit's built-in agent",
}: ChannelsStartPromptProps) {
  const posthog = usePostHog();
  const pathname = usePathname();
  const [copyState, setCopyState] = React.useState<CopyState>("idle");
  const resetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  React.useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  // This component only renders on channel-scoped pages, so anything that is
  // not Teams is the Slack variant.
  const channel: ChannelsActivationChannelId =
    frontend === "teams" ? "teams" : "slack";
  const channelLabel = CHANNEL_LABELS[channel];
  const prompt = buildChannelsActivationPrompt({
    channelLabel,
    backendLabel,
  });
  const { command, instruction } = buildChannelsActivationPromptParts({
    channelLabel,
    backendLabel,
  });

  async function copyPrompt() {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);

    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState("copied");
      posthog?.capture(CHANNELS_ACTIVATION_EVENTS.promptCopied, {
        channel,
        backend: "built-in-agent",
        from_path: pathname,
        surface: "docs_channels_overview",
      });
      resetTimerRef.current = setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("error");
      resetTimerRef.current = setTimeout(() => setCopyState("idle"), 2600);
    }
  }

  return (
    <section
      aria-labelledby="channels-start-prompt-heading"
      className="shell-docs-radius-surface my-6 border p-5 sm:p-6"
      style={{
        borderColor: "color-mix(in oklch, var(--accent) 32%, var(--border))",
        background:
          "linear-gradient(145deg, color-mix(in oklch, var(--accent) 10%, var(--bg-surface)) 0%, var(--bg-surface) 62%)",
      }}
    >
      {/* Header mirrors the featured-Accordion treatment: icon, eyebrow,
          title, supporting line, and the action on the right at wide widths.
          The action lives here rather than beside the command so the command
          gets the panel's full width — at half width it wrapped mid-flag. */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span
            aria-hidden="true"
            className="shell-docs-radius-control flex h-12 w-12 shrink-0 items-center justify-center bg-[var(--accent)] text-[var(--primary-foreground)] shadow-[var(--shadow-control)]"
          >
            <SquareTerminal className="h-5 w-5" />
          </span>

          <div className="min-w-0">
            <span className="mb-1.5 block font-mono text-[11px] font-semibold tracking-[0.12em] text-[var(--accent)] uppercase">
              Ready-to-use starter prompt
            </span>
            <h2
              id="channels-start-prompt-heading"
              className="m-0 text-lg leading-snug font-semibold tracking-[-0.015em] text-[var(--text)] sm:text-xl"
            >
              Start building with your coding agent
            </h2>
            <p className="mt-1.5 mb-0 max-w-[62ch] text-sm leading-relaxed text-[var(--text-secondary)]">
              Paste this into your coding agent. It installs the onboarding
              skill and walks the whole setup with you — scaffolding the
              project, building the agent, and connecting it to {channelLabel}.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={copyPrompt}
          className="shell-docs-radius-control inline-flex min-h-11 w-full shrink-0 cursor-pointer items-center justify-center gap-2 border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--primary-foreground)] shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none sm:w-auto"
        >
          <Copy aria-hidden="true" className="h-4 w-4" />
          {copyState === "copied"
            ? "Copied"
            : copyState === "error"
              ? "Copy blocked"
              : "Copy prompt"}
        </button>
      </div>

      {/* Exactly the text the button copies, rendered as the sentence it is.
          Shown as a command in a code block with the ask underneath, it read
          as a shell command with a footnote — which made "Copy prompt" look
          like it was lying. Only the command is monospace; the prose around it
          wraps like prose. */}
      <p className="shell-docs-radius-control mt-4 mb-0 border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm leading-relaxed text-[var(--text)]">
        {"Run "}
        <code className="font-mono text-xs text-[var(--text)]">{command}</code>
        {`, then ${instruction}`}
      </p>

      <span aria-live="polite" className="sr-only">
        {copyState === "copied"
          ? "Prompt copied"
          : copyState === "error"
            ? "Prompt copy failed. Try again."
            : ""}
      </span>
    </section>
  );
}

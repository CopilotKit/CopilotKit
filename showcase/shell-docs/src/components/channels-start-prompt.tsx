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
import {
  CHANNELS_ACTIVATION_EVENTS,
  buildChannelsActivationPrompt,
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
      className="shell-docs-radius-control my-8 border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-control)]"
    >
      <h2
        id="channels-start-prompt-heading"
        className="m-0 text-base font-semibold text-[var(--text)]"
      >
        Build this with your coding agent
      </h2>
      <p className="mt-1.5 mb-0 text-sm leading-relaxed text-[var(--text-secondary)]">
        Paste this into your coding agent. It installs the onboarding skill and
        walks the whole setup with you — scaffolding the project, building the
        agent, and connecting it to {channelLabel}.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <p className="shell-docs-radius-control m-0 min-w-0 flex-1 overflow-x-auto border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-[var(--text-secondary)]">
          {prompt}
        </p>

        <button
          type="button"
          onClick={copyPrompt}
          className="shell-docs-radius-control inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--primary-foreground)] shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none sm:self-start"
        >
          {copyState === "copied"
            ? "Copied"
            : copyState === "error"
              ? "Copy blocked"
              : "Copy prompt"}
        </button>
      </div>

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

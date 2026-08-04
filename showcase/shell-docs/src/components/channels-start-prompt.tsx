"use client";

// <ChannelsStartPrompt> — the Channels overview page's road into onboarding.
//
// Every Channels surface (this page, the docs landing activation strip,
// copilotkit.ai/channels, the channels-sdk README) points at the same skill
// with the same two sentences. They used to carry the workflow inline instead:
// six copies across three repos, which drifted apart and went stale against the
// CLI, so developers were told to run commands that no longer existed.
//
// The prompts this replaced were twenty lines long and hidden behind an
// accordion. At one line there is nothing to disclose, so the panel is always
// open and the button hands the text straight to the clipboard.

import React from "react";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { Copy, SquareTerminal } from "lucide-react";
import {
  CHANNELS_ACTIVATION_EVENTS,
  CHANNELS_ACTIVATION_SURFACES,
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
  const panelRef = React.useRef<HTMLElement | null>(null);
  const viewedRef = React.useRef(false);

  // This component only renders on channel-scoped pages, so anything that is
  // not Teams is the Slack variant.
  const channel: ChannelsActivationChannelId =
    frontend === "teams" ? "teams" : "slack";
  const channelLabel = CHANNEL_LABELS[channel];

  React.useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  // Impression, so the copy count has a denominator. The panel sits at the top
  // of the overview page but still below the fold on short viewports, so mount
  // is not the same as seen.
  React.useEffect(() => {
    const node = panelRef.current;
    if (!node || viewedRef.current) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || viewedRef.current) continue;
          viewedRef.current = true;
          observer.disconnect();
          capture(CHANNELS_ACTIVATION_EVENTS.viewed, {
            channel,
            backend: "built-in-agent",
            from_path: pathname,
            surface: CHANNELS_ACTIVATION_SURFACES.docsChannelsOverview,
          });
        }
      },
      { threshold: 0.5 },
    );

    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  const prompt = buildChannelsActivationPrompt({
    channelLabel,
    backendLabel,
  });

  function capture(event: string, properties: Record<string, unknown>) {
    try {
      posthog?.capture(event, properties);
    } catch {
      // Analytics must never interrupt docs rendering or clipboard actions.
    }
  }

  async function copyPrompt() {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);

    // Only the clipboard write decides the state shown to the reader. Sharing
    // one try block with the capture call meant a throwing analytics client
    // reported "Copy blocked" for a prompt that was already on the clipboard.
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      setCopyState("error");
      resetTimerRef.current = setTimeout(() => setCopyState("idle"), 2600);
      return;
    }

    setCopyState("copied");
    capture(CHANNELS_ACTIVATION_EVENTS.promptCopied, {
      channel,
      backend: "built-in-agent",
      from_path: pathname,
      surface: CHANNELS_ACTIVATION_SURFACES.docsChannelsOverview,
    });
    resetTimerRef.current = setTimeout(() => setCopyState("idle"), 1800);
  }

  return (
    <section
      ref={panelRef}
      aria-labelledby="channels-start-prompt-heading"
      className="shell-docs-radius-surface my-6 border p-5 sm:p-6"
      style={{
        borderColor: "color-mix(in oklch, var(--accent) 32%, var(--border))",
        background:
          "linear-gradient(145deg, color-mix(in oklch, var(--accent) 10%, var(--bg-surface)) 0%, var(--bg-surface) 62%)",
      }}
    >
      {/* Mirrors the featured-Accordion treatment from #6356: icon, eyebrow,
          title, action, supporting line. The action sits directly under the
          heading rather than off to the right — the prompt itself is not on the
          page, so the button is the whole point of the panel and reads better as
          the next thing after the headline than as trailing furniture. */}
      <div className="flex min-w-0 items-start gap-4">
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

          <button
            type="button"
            onClick={copyPrompt}
            className="shell-docs-radius-control mt-3 inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--primary-foreground)] shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none sm:w-auto"
          >
            <Copy aria-hidden="true" className="h-4 w-4" />
            {copyState === "copied"
              ? "Copied"
              : copyState === "error"
                ? "Copy blocked"
                : "Copy prompt"}
          </button>

          <p className="mt-3 mb-0 max-w-[62ch] text-sm leading-relaxed text-[var(--text-secondary)]">
            It installs the onboarding skill and walks the whole setup with you
            — scaffolding the project, building the agent, and connecting it to{" "}
            {channelLabel}.
          </p>
        </div>
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

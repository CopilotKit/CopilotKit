"use client";

// <ChannelsStartPrompt> — the Channels overview page's road into onboarding.
//
// Every Channels surface (this page, the docs landing activation strip,
// copilotkit.ai/channels, the channels-sdk README) points at the same skill
// with the same two sentences. They used to carry the workflow inline instead:
// six copies across three repos, which drifted apart and went stale against the
// CLI, so developers were told to run commands that no longer existed.
//
// The container is the shared featured `<Accordion>` from #6356, reused rather
// than restyled: it keeps the overview compact when collapsed, and readers can
// expand to inspect the exact prompt before copying it. This component adds the
// two things markup alone cannot — the Slack/Teams switch, and the analytics
// that say whether the road is used at all.

import React from "react";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { Check, Copy } from "lucide-react";
import { Accordion } from "./mdx-components";
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
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const viewedRef = React.useRef(false);
  const expandedRef = React.useRef(false);

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

  function capture(event: string, properties: Record<string, unknown>) {
    try {
      posthog?.capture(event, properties);
    } catch {
      // Analytics must never interrupt docs rendering or clipboard actions.
    }
  }

  const analyticsProperties = {
    channel,
    backend: "built-in-agent",
    from_path: pathname,
    surface: CHANNELS_ACTIVATION_SURFACES.docsChannelsOverview,
  };

  // Impression, so the copy count has a denominator. Observed on the collapsed
  // container, which is what a reader is actually shown — the prompt inside is
  // hidden until they choose to expand it.
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
          capture(CHANNELS_ACTIVATION_EVENTS.viewed, analyticsProperties);
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

  // Expanding is where a disclosure loses people, and neither `viewed` nor
  // `promptCopied` can see it: a reader who never opened the panel looks
  // identical to one who opened it and walked away. Fires once.
  function handleToggle(event: React.SyntheticEvent<HTMLDivElement>) {
    const details = (event.target as HTMLElement).closest("details");
    if (!details?.open || expandedRef.current) return;
    expandedRef.current = true;
    capture(CHANNELS_ACTIVATION_EVENTS.promptExpanded, analyticsProperties);
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
    capture(CHANNELS_ACTIVATION_EVENTS.promptCopied, analyticsProperties);
    resetTimerRef.current = setTimeout(() => setCopyState("idle"), 1800);
  }

  return (
    <div
      ref={panelRef}
      data-testid="channels-start-prompt"
      onToggle={handleToggle}
    >
      <Accordion
        featured
        title="Start building with your coding agent"
        description={`Give your local coding agent a guided path from a blank directory to a working ${channelLabel} channel.`}
      >
        <p className="mt-0 mb-3">
          It installs the onboarding skill and walks the whole setup with you —
          scaffolding the project, building the agent, and connecting it to{" "}
          {channelLabel}.
        </p>

        <div className="shell-docs-radius-control relative border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
          {/* Wraps rather than scrolls. The docs' usual code block scrolls
              horizontally, which is right for code but hid half of this behind
              the overflow — and the point of the disclosure is that a reader can
              read the whole prompt before copying it. `pe-20` keeps every line
              clear of the copy button. */}
          <pre className="m-0 bg-transparent p-0 pe-20 text-xs leading-relaxed break-words whitespace-pre-wrap">
            <code className="font-mono text-[var(--text)]">{prompt}</code>
          </pre>

          <button
            type="button"
            onClick={copyPrompt}
            aria-label="Copy the starter prompt"
            className="shell-docs-radius-control absolute top-2 right-2 inline-flex h-8 cursor-pointer items-center gap-1.5 border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 text-xs font-semibold text-[var(--text)] shadow-[var(--shadow-control)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
          >
            {copyState === "copied" ? (
              <Check aria-hidden="true" className="h-3.5 w-3.5" />
            ) : (
              <Copy aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            {copyState === "copied"
              ? "Copied"
              : copyState === "error"
                ? "Copy blocked"
                : "Copy"}
          </button>
        </div>

        <span aria-live="polite" className="sr-only">
          {copyState === "copied"
            ? "Prompt copied"
            : copyState === "error"
              ? "Prompt copy failed. Try again."
              : ""}
        </span>
      </Accordion>
    </div>
  );
}

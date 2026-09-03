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
import { Copy, SquareTerminal } from "lucide-react";
import {
  CHANNELS_ACTIVATION_EVENTS,
  CHANNELS_ACTIVATION_SURFACES,
  CHANNELS_BUILD_PROMPT,
} from "@/lib/channels-activation-contracts";
import type { ChannelsActivationChannelId } from "@/lib/channels-activation-contracts";
// The client-side mirror of `ROOT_FRAMEWORK`. Importing the registry itself
// from a client component would pull registry.json into the bundle.
import { DEFAULT_FRAMEWORK } from "./framework-provider";

type CopyState = "idle" | "copied" | "error";

export interface ChannelsStartPromptProps {
  /** Injected from the page's docs frontend by the MDX component map. */
  frontend?: string;
  /** Injected from the page's docs framework by the MDX component map. */
  backend?: string;
}

const CHANNEL_LABELS: Record<ChannelsActivationChannelId, string> = {
  slack: "Slack",
  teams: "Microsoft Teams",
};

export function ChannelsStartPrompt({
  frontend,
  backend,
}: ChannelsStartPromptProps) {
  const posthog = usePostHog();
  const pathname = usePathname();
  const [copyState, setCopyState] = React.useState<CopyState>("idle");
  const resetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const panelRef = React.useRef<HTMLDivElement | null>(null);
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

  function capture(event: string, properties: Record<string, unknown>) {
    try {
      posthog?.capture(event, properties);
    } catch {
      // Analytics must never interrupt docs rendering or clipboard actions.
    }
  }

  const analyticsProperties = {
    channel,
    backend: backend ?? DEFAULT_FRAMEWORK,
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

  async function copyPrompt() {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);

    // Only the clipboard write decides the state shown to the reader. Sharing
    // one try block with the capture call meant a throwing analytics client
    // reported "Copy blocked" for a prompt that was already on the clipboard.
    try {
      await navigator.clipboard.writeText(CHANNELS_BUILD_PROMPT);
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
      className="shell-docs-radius-surface not-prose my-6 border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-control)]"
    >
      {/* No disclosure. The payload is one action, so there is nothing to reveal
          — and the same in-content panel idiom as `OpsPlatformCTA`: neutral
          surface, `--border`, accent carried only by a small glyph. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <SquareTerminal
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]"
          />

          <div className="min-w-0">
            <span className="block font-semibold text-[var(--text)]">
              Start building with your coding agent
            </span>
            <span className="mt-1 block max-w-[62ch] text-sm leading-relaxed text-[var(--text-muted)]">
              It walks your agent through the whole setup — choosing a
              framework, scaffolding the project, building the agent, and
              connecting it to {channelLabel}.
            </span>
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

      <span aria-live="polite" className="sr-only">
        {copyState === "copied"
          ? "Prompt copied"
          : copyState === "error"
            ? "Prompt copy failed. Try again."
            : ""}
      </span>
    </div>
  );
}

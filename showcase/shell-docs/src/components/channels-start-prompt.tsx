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
import { DocsPromptActions } from "./docs-prompt-actions";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { SquareTerminal } from "lucide-react";
import {
  CHANNELS_ACTIVATION_EVENTS,
  CHANNELS_ACTIVATION_SURFACES,
} from "@/lib/channels-activation-contracts";
import {
  CHANNELS_ONBOARDING_INTENT,
  createChannelsOnboardingAttempt,
} from "@/lib/channels-onboarding-prompt";
import type { ChannelsActivationChannelId } from "@/lib/channels-activation-contracts";

export interface ChannelsStartPromptProps {
  /** Injected from the page's docs frontend by the MDX component map. */
  frontend?: string;
}

const CHANNEL_LABELS: Record<ChannelsActivationChannelId, string> = {
  slack: "Slack",
  teams: "Microsoft Teams",
};

export function ChannelsStartPrompt({ frontend }: ChannelsStartPromptProps) {
  const posthog = usePostHog();
  const pathname = usePathname();
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const viewedRef = React.useRef(false);

  // This component only renders on channel-scoped pages, so anything that is
  // not Teams is the Slack variant.
  const channel: ChannelsActivationChannelId =
    frontend === "teams" ? "teams" : "slack";
  const channelLabel = CHANNEL_LABELS[channel];

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

  return (
    <div
      ref={panelRef}
      data-testid="channels-start-prompt"
      className="shell-docs-radius-surface not-prose my-6 border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-control)]"
    >
      {/* No disclosure. The payload is one action, so there is nothing to reveal
          — and the same in-content panel idiom as `OpsPlatformCTA`: neutral
          surface, `--border`, accent carried only by a small glyph. */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between xl:gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <SquareTerminal
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]"
          />

          <div className="min-w-0">
            <span className="block font-semibold text-[var(--text)]">
              Start with your coding agent
            </span>
            <span className="mt-1 block max-w-[62ch] text-sm leading-relaxed text-[var(--text-muted)]">
              It walks your agent through the whole setup — choosing a
              framework, scaffolding the project, building the agent, and
              connecting it to {channelLabel}.
            </span>
          </div>
        </div>

        <DocsPromptActions
          surface={CHANNELS_ACTIVATION_SURFACES.docsChannelsOverview}
          createPrompt={() => {
            const attempt = createChannelsOnboardingAttempt();
            return {
              text: attempt.prompt,
              onCopied: () =>
                capture(CHANNELS_ACTIVATION_EVENTS.promptCopied, {
                  ...analyticsProperties,
                  onboarding_run_id: attempt.runId,
                  onboarding_intent: CHANNELS_ONBOARDING_INTENT,
                }),
            };
          }}
        />
      </div>
    </div>
  );
}

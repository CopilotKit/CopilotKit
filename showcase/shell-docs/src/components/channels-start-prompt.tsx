"use client";

import React from "react";
import { CodingAgentSetupPrompt } from "./coding-agent-setup-prompt";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import {
  CHANNEL_LABELS,
  CHANNELS_ACTIVATION_EVENTS,
  CHANNELS_ACTIVATION_SURFACES,
} from "@/lib/channels-activation-contracts";
import { createChannelsOnboardingAttempt } from "@/lib/channels-onboarding-prompt";
import type { ChannelsActivationChannelId } from "@/lib/channels-activation-contracts";

export interface ChannelsStartPromptProps {
  /** Injected from the page's docs frontend by the MDX component map. */
  frontend?: string;
}

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

  // Count impressions of the shared setup controls once per page view.
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
    <div ref={panelRef} data-testid="channels-start-prompt">
      <CodingAgentSetupPrompt
        summary={`Set up ${channelLabel} with your coding agent`}
        feature="channels"
        includePageSource
        copySurface={CHANNELS_ACTIVATION_SURFACES.docsChannelsOverview}
        copiedEvent={CHANNELS_ACTIVATION_EVENTS.promptCopied}
        prompt={() => {
          const attempt = createChannelsOnboardingAttempt();
          return {
            text: attempt.prompt,
            analyticsProperties: {
              ...analyticsProperties,
              onboarding_run_id: attempt.runId,
            },
          };
        }}
      />
    </div>
  );
}

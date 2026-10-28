"use client";

import { useEffect, useRef } from "react";
import { trackEvent } from "@/lib/telemetry/analytics";
import type { DocsScope } from "../scope";
import {
  CHANNELS_ACTIVATION_EVENTS,
  CHANNELS_ACTIVATION_SURFACES,
  createChannelsOnboardingPrompt,
  createOnboardingRunId,
} from "./onboarding";
import { usePageStack } from "./page-stack";
import { CodingAgentSetupPrompt } from "./prompt-actions";

const CHANNEL_LABELS = { slack: "Slack", teams: "Microsoft Teams" } as const;

/**
 * The Channels overview's coding-agent prompt (shell-docs'
 * `ChannelsStartPrompt`): the plain onboarding prompt plus the page it came
 * from, and a one-time impression so copies have a denominator.
 */
export function ChannelsStartPrompt({
  scope,
  frontend: frontendProp,
}: {
  scope: DocsScope;
  /** Slack or Teams; defaults to the page's frontend. */
  frontend?: string;
}) {
  const stack = usePageStack(scope);
  const channel = (frontendProp ?? stack.frontend) === "teams" ? "teams" : "slack";
  const panelRef = useRef<HTMLDivElement | null>(null);
  const viewedRef = useRef(false);

  const analyticsProperties = {
    channel,
    backend: "built-in-agent",
    from_path: stack.pathname,
    surface: CHANNELS_ACTIVATION_SURFACES.docsChannelsOverview,
  };

  useEffect(() => {
    const node = panelRef.current;
    if (!node || viewedRef.current) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || viewedRef.current) continue;
          viewedRef.current = true;
          observer.disconnect();
          trackEvent(CHANNELS_ACTIVATION_EVENTS.viewed, analyticsProperties);
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => observer.disconnect();
    // Once per channel, as in shell-docs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  return (
    <div ref={panelRef} data-testid="channels-start-prompt">
      <CodingAgentSetupPrompt
        scope={scope}
        summary={`Set up ${CHANNEL_LABELS[channel]} with your coding agent`}
        feature="channels"
        includePageSource
        copySurface={CHANNELS_ACTIVATION_SURFACES.docsChannelsOverview}
        copiedEvent={CHANNELS_ACTIVATION_EVENTS.promptCopied}
        prompt={() => {
          const runId = createOnboardingRunId();
          return {
            text: createChannelsOnboardingPrompt(runId),
            analyticsProperties: {
              ...analyticsProperties,
              onboarding_run_id: runId,
            },
          };
        }}
      />
    </div>
  );
}

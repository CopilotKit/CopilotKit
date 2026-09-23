"use client";

import { usePostHog } from "posthog-js/react";

type HomepageAction =
  | "wizard_step_changed"
  | "manual_setup_clicked"
  | "walkthrough_selected"
  | "video_play_clicked"
  | "integration_selected"
  | "frontend_selected"
  | "quickstart_selected";

export function useHomepageTelemetry() {
  const posthog = usePostHog();
  return (action: HomepageAction, properties: Record<string, unknown> = {}) => {
    try {
      posthog?.capture(`docs.homepage_${action}`, {
        from_path: window.location.pathname,
        ...properties,
      });
    } catch {
      // Analytics must never interrupt navigation or setup.
    }
  };
}

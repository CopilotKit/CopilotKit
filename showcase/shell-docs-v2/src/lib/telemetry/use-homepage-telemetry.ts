"use client";

import { useCallback } from "react";
import { trackEvent } from "./analytics";

// Ported from shell-docs. Fires `docs.homepage_<action>` with `from_path`.
type HomepageAction =
  | "wizard_step_changed"
  | "manual_setup_clicked"
  | "walkthrough_selected"
  | "walkthrough_link_clicked"
  | "video_play_clicked"
  | "integration_selected"
  | "frontend_selected"
  | "quickstart_selected";

export function useHomepageTelemetry() {
  return useCallback(
    (action: HomepageAction, properties: Record<string, unknown> = {}) => {
      trackEvent(`docs.homepage_${action}`, {
        from_path: window.location.pathname,
        ...properties,
      });
    },
    [],
  );
}

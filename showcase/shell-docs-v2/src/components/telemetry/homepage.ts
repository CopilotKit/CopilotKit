"use client";

import { useCallback, type MouseEvent } from "react";
import { useHomepageTelemetry } from "@/lib/telemetry/use-homepage-telemetry";
import { useFrontend } from "@/proto/frontend";
import { locationFromPathname } from "@/proto/routes";

/**
 * Click handler for the home's Integrations section: a click on any framework
 * card link (including a family card's variant popover, which React bubbles
 * through its portal) reports `docs.homepage_integration_selected` with
 * shell-docs' properties.
 */
export function useIntegrationClickTracking() {
  const track = useHomepageTelemetry();
  const { frontend } = useFrontend();
  return useCallback(
    (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const destination = event.target.closest("a")?.getAttribute("href");
      const loc = destination
        ? locationFromPathname(destination).location
        : null;
      if (loc?.kind !== "framework") return;
      track("integration_selected", {
        frontend,
        backend: loc.framework,
        destination,
      });
    },
    [track, frontend],
  );
}

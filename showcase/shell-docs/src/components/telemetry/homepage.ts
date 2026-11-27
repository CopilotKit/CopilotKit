"use client";

import { useCallback } from "react";
import type { MouseEvent } from "react";
import { useHomepageTelemetry } from "@/lib/telemetry/use-homepage-telemetry";
import { useFrontend } from "@/proto/frontend";
import { ROOT_FRAMEWORK, scopeFromPath } from "@/lib/live-scope";

/**
 * Click handler for the home's Integrations section: a click on any framework
 * card link (including a family card's variant popover, which React bubbles
 * through its portal) reports `docs.homepage_integration_selected` with
 * shell-docs' properties. A card opens on the reader's frontend
 * (`/vue/mastra/quickstart`), and the built-in agent's has no framework
 * segment (`/quickstart`), so the framework is read from the URL's scope.
 */
export function useIntegrationClickTracking() {
  const track = useHomepageTelemetry();
  const { frontend } = useFrontend();
  return useCallback(
    (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const destination = event.target.closest("a")?.getAttribute("href");
      if (!destination?.startsWith("/") || destination.startsWith("//")) return;
      const path = destination.split(/[?#]/, 1)[0].split("/").filter(Boolean);
      if (!path.length) return;
      track("integration_selected", {
        frontend,
        backend: scopeFromPath(path).framework ?? ROOT_FRAMEWORK,
        destination,
      });
    },
    [track, frontend],
  );
}

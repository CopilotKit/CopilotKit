"use client";

import { useEffect } from "react";
import { usePostHog } from "posthog-js/react";
import { trackCommandCopy } from "@/lib/track-command-copy";

export function CopyTracker() {
  const posthog = usePostHog();

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText)
      return;
    const original = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async function (text: string) {
      // Capture attribution before the async write can move focus or navigate.
      const location = window.location.pathname;
      let conversionSurface: string | undefined;
      try {
        const activeElement = document.activeElement;
        conversionSurface =
          activeElement instanceof Element
            ? activeElement.closest<HTMLElement>("[data-docs-copy-surface]")
                ?.dataset.docsCopySurface
            : undefined;
      } catch {
        // Attribution must not prevent copying.
      }
      await original(text);
      try {
        trackCommandCopy(posthog, {
          command: text,
          location,
        });
        if (conversionSurface) {
          posthog?.capture("docs_conversion_copied", {
            surface: conversionSurface,
          });
        }
      } catch {
        // Never let analytics break the underlying copy.
      }
    };
    return () => {
      navigator.clipboard.writeText = original;
    };
  }, [posthog]);

  return null;
}

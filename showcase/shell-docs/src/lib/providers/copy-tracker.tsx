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
      try {
        const activeElement = document.activeElement;
        const conversionSurface =
          activeElement instanceof Element
            ? activeElement.closest<HTMLElement>("[data-docs-copy-surface]")
                ?.dataset.docsCopySurface
            : undefined;

        trackCommandCopy(posthog, {
          command: text,
          location:
            typeof window !== "undefined"
              ? window.location.pathname
              : undefined,
        });
        if (conversionSurface) {
          posthog?.capture("docs_conversion_copied", {
            surface: conversionSurface,
          });
        }
      } catch {
        // Never let analytics break the underlying copy.
      }
      return original(text);
    };
    return () => {
      navigator.clipboard.writeText = original;
    };
  }, [posthog]);

  return null;
}

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
        trackCommandCopy(posthog, {
          command: text,
          location:
            typeof window !== "undefined"
              ? window.location.pathname
              : undefined,
        });
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

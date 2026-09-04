"use client";

import { useEffect, useState } from "react";
import { createOnboardingRunId } from "@/lib/intelligence-onboarding-prompt";

/**
 * One run id per mount, not per click: repeated clicks are one reader making
 * one onboarding attempt, and only the id that survives on the clipboard can
 * ever be reported back by the CLI. Minting per click would leave every click
 * but the last as a funnel row nothing could close out.
 *
 * Minted in an effect rather than a `useState` initialiser to keep id
 * generation out of render entirely. Hydration does not force the choice:
 * `createOnboardingRunId` falls back to `Math.random` where `crypto` is
 * missing and never throws, and the id is never rendered, so there is no
 * markup for a server id and a client id to disagree about.
 *
 * Returns a getter rather than the id itself: a click before the effect has
 * run still has to copy a usable prompt, so the getter falls back to minting
 * one inline when the mount has not settled on one yet.
 */
export function useOnboardingRunId(): () => string {
  const [runId, setRunId] = useState<string | null>(null);

  useEffect(() => {
    setRunId(createOnboardingRunId());
  }, []);

  return () => runId ?? createOnboardingRunId();
}

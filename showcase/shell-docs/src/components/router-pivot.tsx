"use client";

// RouterPivot — client-side redirect from `/docs/<feature>` to
// `/<effectiveFramework>/<feature>`. With Built-in Agent as the soft
// default, every visitor has an effectiveFramework, so this component's
// only job is to issue the redirect and render a brief placeholder.
//
// The picker grid that previously rendered when neither URL nor stored
// framework was set has been removed — the FrameworkProvider's
// soft-default makes that branch unreachable, and the categorized
// picker on the docs landing handles the explicit "switch backend"
// affordance.

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFramework } from "./framework-provider";

export interface RouterPivotProps {
  /** Slug path (no leading slash). */
  slugPath: string;
}

/**
 * Hide the MDX body on `/docs/<feature>` while RouterPivot redirects to
 * the framework-scoped URL. With BIA as the soft-default the redirect
 * always fires, so this just keeps the body from flashing during the
 * tick before navigation completes.
 */
export function FrameworkGuardedContent({
  children: _children,
}: {
  children: React.ReactNode;
}) {
  return null;
}

export function RouterPivot({ slugPath }: RouterPivotProps) {
  const router = useRouter();
  const { effectiveFramework } = useFramework();

  useEffect(() => {
    router.replace(`/${effectiveFramework}/${slugPath}`);
  }, [effectiveFramework, router, slugPath]);

  return (
    <div className="text-xs text-[var(--text-muted)]">
      Loading {effectiveFramework} view…
    </div>
  );
}

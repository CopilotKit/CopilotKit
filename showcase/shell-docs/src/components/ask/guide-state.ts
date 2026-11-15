"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useGenerativeUIRuntime } from "@copilotkit/react-core/v2/generative-ui";

/*
 * The guide's state, apart from its panel, so guide-panel.tsx exports only
 * components and Fast Refresh can swap it in place during a run.
 */

/** The page target the agent writes guides into (docs-agent.ts' prompt). */
export const GUIDE_TARGET = "guide";

export interface Guide {
  surfaceId: string;
  status: "streaming" | "ready" | "error";
  /** The committed operations; a new array whenever the guide changes. */
  operations: readonly unknown[];
}

/** The guide the agent has written into the guide target, if any. */
export function useGuide(): Guide | null {
  const manager = useGenerativeUIRuntime()?.manager;
  const subscribe = useCallback(
    (onChange: () => void) => manager?.subscribe(onChange) ?? (() => {}),
    [manager],
  );
  const version = useSyncExternalStore(
    subscribe,
    () => manager?.getVersion() ?? 0,
    () => 0,
  );
  return useMemo(() => {
    const surface = manager?.getSurfaceForTarget(GUIDE_TARGET);
    if (!surface || surface.failed) return null;
    return {
      surfaceId: surface.surfaceId,
      status: surface.status,
      operations: surface.operations,
    };
    // The manager mutates its surfaces; `version` says when.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager, version]);
}

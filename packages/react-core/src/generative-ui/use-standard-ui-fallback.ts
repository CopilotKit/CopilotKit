import { useEffect, useMemo, useState } from "react";
import { ɵresolveGenerativeUIDefault } from "@copilotkit/core";
import type { GenerativeUI } from "./catalog";
import type { GenerativeUIConfig } from "./runtime-context";

/**
 * The standard UI, loaded once on first use. It is a dynamic import so the
 * standard components (chart, map, media, ...) stay out of the main entry:
 * an app that does not use generative UI never downloads them.
 */
let standardUIPromise: Promise<GenerativeUI> | undefined;

function loadStandardUI(): Promise<GenerativeUI> {
  if (!standardUIPromise) {
    standardUIPromise = import("./standard").then(
      (module) => module.standardUI,
    );
    // A failed load is tried again on the next use.
    standardUIPromise.catch(() => {
      standardUIPromise = undefined;
    });
  }
  return standardUIPromise;
}

/** The runtime info that decides the fallback. */
export interface StandardUIFallbackRuntimeInfo {
  generativeUIEnabled: boolean;
  generativeUIAgents: string[] | undefined;
}

/**
 * The generative UI config of the provider. That is the `generativeUI` prop
 * when it has a `ui`. Otherwise, when the runtime turns generative UI on, it
 * is the standard UI for the agents of the runtime, once the standard UI has
 * loaded, with the other options of the prop (such as `map` or `theme`).
 * `undefined` while generative UI is off, or still loading.
 */
export function useStandardUIFallback(
  generativeUI: GenerativeUIConfig | undefined,
  runtimeInfo: StandardUIFallbackRuntimeInfo | null,
): GenerativeUIConfig | undefined {
  const fallback = ɵresolveGenerativeUIDefault({
    runtimeEnabled: runtimeInfo?.generativeUIEnabled ?? false,
    runtimeAgents: runtimeInfo?.generativeUIAgents,
    hasUI: !!generativeUI?.ui,
  });
  const active = fallback.active;
  const agentIds = fallback.active ? fallback.agentIds : undefined;

  const [standardUI, setStandardUI] = useState<GenerativeUI>();
  useEffect(() => {
    if (!active || standardUI) return;
    let cancelled = false;
    loadStandardUI().then(
      (ui) => {
        if (!cancelled) setStandardUI(ui);
      },
      (error: unknown) => {
        console.error(
          "[generativeUI] could not load the standard UI for the runtime's generative UI:",
          error,
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, standardUI]);

  return useMemo(() => {
    if (generativeUI?.ui) return generativeUI;
    if (!active || !standardUI) return undefined;
    return {
      ...generativeUI,
      ui: standardUI,
      agentIds: generativeUI?.agentIds ?? agentIds,
    };
  }, [generativeUI, active, standardUI, agentIds]);
}

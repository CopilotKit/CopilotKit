"use client";

import { createContext, useContext, useState } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import { blockSurfaceIdFrom } from "@/shell/chat/inline-block-surface";

type SurfaceKind = "report" | "ogui";

interface CanvasValue {
  activeSurfaceKind: SurfaceKind | null;
  activeSurfaceId: string | null;
  clear: () => void;
}

const CanvasContext = createContext<CanvasValue>({
  activeSurfaceKind: null,
  activeSurfaceId: null,
  clear: () => {},
});

/** Minimal shape of an activity message in the agent's message list. */
type MaybeActivityMessage = {
  id?: string;
  role?: string;
  activityType?: string;
  content?: unknown;
};

/**
 * The latest canvas surface (report or OGUI) in the stream, whichever is most
 * recent. Generic: it keys off the activity type and the message id only, so it
 * works for any skin without knowing its catalog. The a2ui report surface id is
 * derived generically as `m.id ?? "a2ui-surface"` — a specific skin's report
 * ops are the skin's concern (its CanvasSurface), not the shell's.
 */
function useLatestCanvasSurface(): {
  kind: SurfaceKind | null;
  surfaceId: string | null;
} {
  const { agent } = useAgent();
  const messages = agent?.messages as MaybeActivityMessage[] | undefined;
  if (messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role !== "activity") continue;
      if (m.activityType === "a2ui-surface") {
        // Inline `block:` surfaces are NOT canvas events: they render where the
        // activity sits in the transcript (<InlineBlockSurface/>). Claiming them
        // here would flip the whole content region into a report frame — blank
        // for any skin without a CanvasSurface — and bury the page behind a bare
        // "← Back". Skip them so an earlier real surface (or nothing) wins; the
        // canvas contract is reports + OGUI only.
        if (blockSurfaceIdFrom(m.content)) continue;
        return { kind: "report", surfaceId: m.id ?? "a2ui-surface" };
      }
      if (m.activityType === "open-generative-ui")
        return { kind: "ogui", surfaceId: m.id ?? null };
    }
  }
  return { kind: null, surfaceId: null };
}

/**
 * Tracks whether a surface (A2UI report or OGUI) should occupy the content
 * region, and which KIND. Derives from the latest surface activity in the
 * agent's message stream and layers a local dismiss for the "← Back" control.
 * Unique per-surface ids mean dismissing one never suppresses a later one.
 */
export function CanvasProvider({ children }: { children: React.ReactNode }) {
  const { kind, surfaceId } = useLatestCanvasSurface();
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  const active = !!surfaceId && surfaceId !== dismissedId;
  const activeSurfaceId = active ? surfaceId : null;
  const activeSurfaceKind = active ? kind : null;

  const clear = () => setDismissedId(surfaceId);

  return (
    <CanvasContext.Provider
      value={{ activeSurfaceKind, activeSurfaceId, clear }}
    >
      {children}
    </CanvasContext.Provider>
  );
}

export function useCanvas(): CanvasValue {
  return useContext(CanvasContext);
}

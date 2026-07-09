"use client";

import { createContext, useContext, useState } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import { useReportSurface } from "./use-report-surface";

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
};

/** The latest canvas surface (report or OGUI) in the stream, whichever is most recent. */
function useLatestCanvasSurface(): {
  kind: SurfaceKind | null;
  surfaceId: string | null;
} {
  const { agent } = useAgent();
  const { surfaceId: reportId } = useReportSurface();
  const messages = agent?.messages as MaybeActivityMessage[] | undefined;
  if (messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role !== "activity") continue;
      if (m.activityType === "a2ui-surface")
        return { kind: "report", surfaceId: reportId };
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

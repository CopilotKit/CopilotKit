"use client";

import { createContext, useContext, useState } from "react";
import { useReportSurface } from "./use-report-surface";

interface CanvasValue {
  activeSurfaceId: string | null;
  clear: () => void;
}

const CanvasContext = createContext<CanvasValue>({
  activeSurfaceId: null,
  clear: () => {},
});

/**
 * Tracks whether a report surface should currently occupy the content region.
 *
 * The surface itself lives in the agent's message stream (see useReportSurface);
 * this provider derives "is a surface active" from the latest one and layers a
 * local dismiss on top so the "← Back" control can hide it. Because each report
 * gets a unique surfaceId, dismissing one never suppresses a later report.
 */
export function CanvasProvider({ children }: { children: React.ReactNode }) {
  const { surfaceId } = useReportSurface();
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  const activeSurfaceId =
    surfaceId && surfaceId !== dismissedId ? surfaceId : null;

  const clear = () => setDismissedId(surfaceId);

  return (
    <CanvasContext.Provider value={{ activeSurfaceId, clear }}>
      {children}
    </CanvasContext.Provider>
  );
}

export function useCanvas(): CanvasValue {
  return useContext(CanvasContext);
}

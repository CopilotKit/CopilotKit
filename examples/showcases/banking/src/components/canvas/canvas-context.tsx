"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { surfaceBus } from "@/a2ui/surface-bus";

const CHANNEL = "default";

interface CanvasValue {
  activeSurfaceId: string | null;
  clear: () => void;
}

const CanvasContext = createContext<CanvasValue>({
  activeSurfaceId: null,
  clear: () => {},
});

export function CanvasProvider({ children }: { children: React.ReactNode }) {
  const [activeSurfaceId, setActiveSurfaceId] = useState<string | null>(null);

  useEffect(() => {
    setActiveSurfaceId(surfaceBus.snapshot(CHANNEL).surfaceId);
    return surfaceBus.subscribe(CHANNEL, (snap) =>
      setActiveSurfaceId(snap.surfaceId),
    );
  }, []);

  const clear = () => surfaceBus.reset(CHANNEL);

  return (
    <CanvasContext.Provider value={{ activeSurfaceId, clear }}>
      {children}
    </CanvasContext.Provider>
  );
}

export function useCanvas(): CanvasValue {
  return useContext(CanvasContext);
}

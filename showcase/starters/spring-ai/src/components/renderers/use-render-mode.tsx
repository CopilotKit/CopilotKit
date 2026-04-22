"use client";

import { useState } from "react";
import { RENDER_MODES, type RenderMode } from "./types";

const STORAGE_KEY = "showcase-render-mode";

const VALID_MODES: Set<string> = new Set(RENDER_MODES);

/**
 * Manages the active render mode with localStorage persistence.
 *
 * Note: Agent context forwarding (useAgentContext) is omitted here because
 * the npm-published @copilotkit/react-core may not export it yet, which
 * causes prerender failures during Docker builds. The backend render_mode
 * middleware falls back to "tool-based" when no context is present.
 */
export function useRenderMode() {
  const [mode, setMode] = useState<RenderMode>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      return VALID_MODES.has(stored ?? "")
        ? (stored as RenderMode)
        : "tool-based";
    }
    return "tool-based";
  });

  const setAndPersist = (newMode: RenderMode) => {
    setMode(newMode);
    localStorage.setItem(STORAGE_KEY, newMode);
  };

  return { mode, setMode: setAndPersist };
}

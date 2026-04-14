"use client";

import { useState } from "react";
import { useAgentContext } from "@copilotkit/react-core";
import { RenderMode } from "./types";

const STORAGE_KEY = "showcase-render-mode";

/**
 * Manages the active render mode with localStorage persistence and
 * CopilotKit agent context forwarding.
 *
 * The mode is automatically exposed to the agent as a `render_mode` context
 * value so backend logic can adapt its output strategy.
 */
export function useRenderMode() {
  const [mode, setMode] = useState<RenderMode>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem(STORAGE_KEY) as RenderMode) || "tool-based";
    }
    return "tool-based";
  });

  // Forward the current render mode to the agent via CopilotKit context.
  useAgentContext({
    description: "render_mode",
    value: mode,
  });

  const setAndPersist = (newMode: RenderMode) => {
    setMode(newMode);
    localStorage.setItem(STORAGE_KEY, newMode);
  };

  return { mode, setMode: setAndPersist };
}

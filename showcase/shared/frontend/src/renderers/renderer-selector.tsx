"use client";

import React from "react";
import { RenderMode, RENDER_STRATEGIES } from "./types";

export interface RendererSelectorProps {
  /** The currently active render mode. */
  mode: RenderMode;
  /** Called when the user selects a different render mode. */
  onModeChange: (mode: RenderMode) => void;
}

/**
 * Horizontal pill-toggle for selecting a render strategy.
 *
 * Each pill shows the strategy icon and name. Hovering reveals a tooltip with
 * the one-line description. The active pill is visually highlighted.
 */
export function RendererSelector({
  mode,
  onModeChange,
}: RendererSelectorProps) {
  return (
    <div
      className="flex flex-wrap gap-2"
      role="radiogroup"
      aria-label="Render mode"
    >
      {RENDER_STRATEGIES.map((strategy) => {
        const isActive = strategy.mode === mode;
        return (
          <button
            key={strategy.mode}
            role="radio"
            aria-checked={isActive}
            title={strategy.description}
            onClick={() => onModeChange(strategy.mode)}
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500",
              isActive
                ? "bg-blue-600 text-white shadow-sm"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700",
            ].join(" ")}
          >
            <span aria-hidden="true">{strategy.icon}</span>
            {strategy.name}
          </button>
        );
      })}
    </div>
  );
}

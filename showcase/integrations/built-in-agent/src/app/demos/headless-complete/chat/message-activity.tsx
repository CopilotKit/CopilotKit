"use client";

/**
 * Wrapper around an activity message rendered by
 * `useRenderActivityMessage`. Used in this demo to host the MCP Apps
 * Excalidraw iframe inside a card-shaped surface that spans the chat
 * column.
 */

import React from "react";

export function ActivityWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full justify-start">
      <div className="w-full max-w-full overflow-hidden rounded-2xl border bg-card shadow-sm">
        {children}
      </div>
    </div>
  );
}

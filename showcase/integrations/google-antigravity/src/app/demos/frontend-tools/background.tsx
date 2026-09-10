"use client";

import React from "react";

// Solid indigo by default — gives the demo a clean canvas while the agent's
// `change_background` tool is the star of the show.
export const DEFAULT_BACKGROUND = "#4f46e5";

export function Background({
  background,
  children,
}: {
  background: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-testid="frontend-tools-background"
      data-background-value={background}
      className="relative h-screen w-full overflow-hidden transition-[background] duration-700"
      style={{ background }}
    >
      {children}
    </div>
  );
}

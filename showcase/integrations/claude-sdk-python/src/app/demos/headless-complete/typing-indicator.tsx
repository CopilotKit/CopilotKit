"use client";

import React from "react";

/**
 * Small animated dot shown while the agent is running but has not yet emitted
 * any assistant content. Styled to look like an assistant bubble so it slots
 * into the message list without layout jitter.
 */
export function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="rounded-2xl rounded-bl-sm bg-[#F0F0F4] px-4 py-3">
        <span className="inline-block w-2 h-2 bg-[#838389] rounded-full animate-pulse" />
      </div>
    </div>
  );
}

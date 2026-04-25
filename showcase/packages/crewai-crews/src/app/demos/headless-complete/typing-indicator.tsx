"use client";

import React from "react";

export function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="rounded-2xl rounded-bl-sm bg-[#F0F0F4] px-4 py-3">
        <span className="inline-block w-2 h-2 bg-[#838389] rounded-full animate-pulse" />
      </div>
    </div>
  );
}

"use client";

import React from "react";

// @region[custom-bubbles]
export function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-testid="headless-message-user"
      data-message-role="user"
      className="flex justify-end"
    >
      <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-[#010507] text-white px-4 py-2 text-sm whitespace-pre-wrap break-words">
        {children}
      </div>
    </div>
  );
}
// @endregion[custom-bubbles]

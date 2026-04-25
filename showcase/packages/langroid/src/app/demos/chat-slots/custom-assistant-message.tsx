"use client";

import React from "react";
import { CopilotChatAssistantMessage } from "@copilotkit/react-core/v2";
import type { CopilotChatAssistantMessageProps } from "@copilotkit/react-core/v2";

export function CustomAssistantMessage(
  props: CopilotChatAssistantMessageProps,
) {
  return (
    <div
      data-testid="custom-assistant-message"
      className="relative rounded-xl border border-indigo-200 bg-indigo-50/60 dark:bg-indigo-950/40 dark:border-indigo-800 p-3 my-3"
    >
      <span className="absolute -top-2 -left-2 inline-block rounded-full bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 shadow">
        slot
      </span>
      <CopilotChatAssistantMessage {...props} />
    </div>
  );
}

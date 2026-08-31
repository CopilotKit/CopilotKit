"use client";

import React from "react";
import { InlineAgentStateCard, type Step } from "./InlineAgentStateCard";

export function MessageListWithState({
  messageElements,
  interruptElement,
  steps,
  status,
}: {
  messageElements: React.ReactNode;
  interruptElement: React.ReactNode;
  steps: Step[];
  status: "inProgress" | "complete";
}) {
  return (
    <div data-testid="copilot-message-list" className="flex flex-col">
      {messageElements}
      {steps.length > 0 && (
        <InlineAgentStateCard steps={steps} status={status} />
      )}
      {interruptElement}
    </div>
  );
}

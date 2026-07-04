"use client";

// @region[context-provider-sketch]
import React, { useState } from "react";
import {
  CopilotKit,
  CopilotPopup,
  useAgentContext,
} from "@copilotkit/react-core/v2";

import { ACTIVITIES, DemoLayout } from "./demo-layout";
import { useReadonlyStateAgentContextSuggestions } from "./suggestions";

export default function ReadonlyStateAgentContextDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="readonly-state-agent-context">
      <DemoContent />
      <CopilotPopup
        agentId="readonly-state-agent-context"
        defaultOpen={true}
        labels={{ chatInputPlaceholder: "Ask about your context..." }}
      />
    </CopilotKit>
  );
}

function DemoContent() {
  const [userName, setUserName] = useState("Atai");
  const [userTimezone, setUserTimezone] = useState("America/Los_Angeles");
  const [recentActivity, setRecentActivity] = useState<string[]>([
    ACTIVITIES[0],
    ACTIVITIES[2],
  ]);
  // @endregion[context-provider-sketch]

  // @region[agent-steering]
  // Per-demo steering via AG-UI context (clawg-ui appends context entries to
  // the OpenClaw agent's prompt). This keeps the "you may read this context"
  // instruction scoped to this demo.
  useAgentContext({
    description: "Operating instructions for this demo",
    value:
      "You are an assistant that can read the user's read-only profile context " +
      "below. When asked who the user is, what timezone they're in, or about " +
      "their recent activity, answer from that context. You cannot modify it.",
  });
  // @endregion[agent-steering]

  // @region[use-agent-context-call]
  useAgentContext({
    description: "The currently logged-in user's display name",
    value: userName,
  });
  useAgentContext({
    description: "The user's IANA timezone (used when mentioning times)",
    value: userTimezone,
  });
  useAgentContext({
    description: "The user's recent activity in the app, newest first",
    // useAgentContext value must be a string — join the activity array so the
    // RunAgentInput.context entry serializes correctly (an array value breaks
    // the /api/copilotkit request, so the run never reaches the agent).
    value: recentActivity.join("; "),
  });
  // @endregion[use-agent-context-call]

  useReadonlyStateAgentContextSuggestions();

  const toggleActivity = (activity: string) => {
    setRecentActivity((prev) =>
      prev.includes(activity)
        ? prev.filter((a) => a !== activity)
        : [...prev, activity],
    );
  };

  return (
    <DemoLayout
      userName={userName}
      userTimezone={userTimezone}
      recentActivity={recentActivity}
      onUserNameChange={setUserName}
      onUserTimezoneChange={setUserTimezone}
      onToggleActivity={toggleActivity}
    />
  );
}

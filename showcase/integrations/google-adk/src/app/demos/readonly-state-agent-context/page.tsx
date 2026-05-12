"use client";

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
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="readonly-state-agent-context"
    >
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
  // @region[context-provider-sketch]
  const [userName, setUserName] = useState("Atai");
  const [userTimezone, setUserTimezone] = useState("America/Los_Angeles");
  const [recentActivity, setRecentActivity] = useState<string[]>([
    ACTIVITIES[0],
    ACTIVITIES[2],
  ]);
  // @endregion[context-provider-sketch]

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
    value: recentActivity,
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

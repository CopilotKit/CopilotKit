"use client";

import React, { useState } from "react";
import {
  CopilotKit,
  CopilotChat,
  useAgentContext,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

// Demo: the frontend provides READ-ONLY context *to* the agent via
// `useAgentContext`. The agent cannot modify these values — they are a
// pure one-way (UI -> agent) channel, surfaced in the agent's context
// on every turn by CopilotKitMiddleware on the backend.
export default function SharedStateAgentReadonlyDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="shared-state-agent-readonly"
    >
      <DemoContent />
    </CopilotKit>
  );
}

const TIMEZONES = [
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
];

const ACTIVITIES = [
  "Viewed the pricing page",
  "Added 'Pro Plan' to cart",
  "Watched the product demo video",
  "Started the 14-day free trial",
  "Invited a teammate",
];

function DemoContent() {
  // Example read-only context the UI publishes to the agent.
  const [userName, setUserName] = useState("Atai");
  const [userTimezone, setUserTimezone] = useState("America/Los_Angeles");
  const [recentActivity, setRecentActivity] = useState<string[]>([
    ACTIVITIES[0],
    ACTIVITIES[2],
  ]);

  // Publish each slice as its own named context. Each call registers a
  // dynamic context entry with the runtime; the entry is automatically
  // removed on unmount, and refreshed whenever the value changes.
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

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Who am I?",
        message: "What do you know about me from my context?",
      },
      {
        title: "Suggest next steps",
        message: "Based on my recent activity, what should I try next?",
      },
      {
        title: "Plan my morning",
        message:
          "What time is it in my timezone and what should I do for the next hour?",
      },
    ],
    available: "always",
  });

  const toggleActivity = (activity: string) => {
    setRecentActivity((prev) =>
      prev.includes(activity)
        ? prev.filter((a) => a !== activity)
        : [...prev, activity],
    );
  };

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-gray-50">
      <aside className="p-4 md:w-[360px] md:shrink-0 overflow-y-auto">
        <div
          data-testid="context-card"
          className="w-full max-w-md p-6 bg-white rounded-2xl shadow-lg border border-gray-100 space-y-5"
        >
          <div>
            <h2 className="text-xl font-bold text-gray-800">Agent Context</h2>
            <p className="text-xs text-gray-500 mt-1">
              Read-only context provided to the agent via{" "}
              <code>useAgentContext</code>. The agent cannot modify these.
            </p>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Name</span>
            <input
              data-testid="ctx-name"
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="e.g. Atai"
              className="mt-1 w-full border rounded px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Timezone</span>
            <select
              data-testid="ctx-timezone"
              value={userTimezone}
              onChange={(e) => setUserTimezone(e.target.value)}
              className="mt-1 w-full border rounded px-3 py-2 text-sm"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className="text-sm font-medium text-gray-700">
              Recent Activity
            </span>
            <div className="mt-2 flex flex-col gap-2">
              {ACTIVITIES.map((activity) => {
                const selected = recentActivity.includes(activity);
                return (
                  <label
                    key={activity}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleActivity(activity)}
                    />
                    <span>{activity}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="pt-3 border-t border-gray-100">
            <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">
              Published Context
            </div>
            <pre
              data-testid="ctx-state-json"
              className="bg-gray-50 rounded p-2 text-xs text-gray-700 overflow-x-auto"
            >
              {JSON.stringify(
                {
                  name: userName,
                  timezone: userTimezone,
                  recentActivity,
                },
                null,
                2,
              )}
            </pre>
          </div>
        </div>
      </aside>
      <main className="flex-1 flex flex-col min-h-0">
        <CopilotChat
          agentId="shared-state-agent-readonly"
          className="flex-1 min-h-0"
          labels={{
            chatInputPlaceholder: "Ask about your context...",
          }}
        />
      </main>
    </div>
  );
}

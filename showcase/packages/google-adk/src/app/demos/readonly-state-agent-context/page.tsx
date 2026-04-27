"use client";

import React, { useState } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useAgentContext,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function ReadonlyStateAgentContextDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="readonly_state_agent_context"
    >
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  const [userName, setUserName] = useState("Daisy");
  const [role, setRole] = useState("Frontend engineer");
  const [project, setProject] = useState(
    "Building a CopilotKit + Google ADK showcase",
  );

  useAgentContext({ description: "User name", value: userName });
  useAgentContext({ description: "User role", value: role });
  useAgentContext({ description: "Current project", value: project });

  useConfigureSuggestions({
    suggestions: [
      { title: "Who am I?", message: "What do you know about me?" },
      {
        title: "Project advice",
        message:
          "Given my role and current project, what should I prioritise this week?",
      },
    ],
    available: "always",
  });

  return (
    <div className="flex h-screen w-full bg-gray-50">
      <aside className="md:w-[340px] md:shrink-0 p-4 overflow-y-auto">
        <div className="rounded-2xl border border-[#DBDBE5] bg-white p-5 shadow-sm space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-[#010507]">
              Read-only context
            </h3>
            <p className="text-xs text-[#838389] mt-1">
              These fields are forwarded into the agent's system prompt every
              turn via useAgentContext. The agent cannot write back.
            </p>
          </div>
          <Field label="Name" value={userName} onChange={setUserName} />
          <Field label="Role" value={role} onChange={setRole} />
          <Field
            label="Current project"
            value={project}
            onChange={setProject}
          />
        </div>
      </aside>
      <main className="flex-1 flex flex-col min-h-0">
        <CopilotChat
          agentId="readonly_state_agent_context"
          className="flex-1 min-h-0"
        />
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[#57575B]">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-[#DBDBE5] rounded-xl px-3 py-2 text-sm text-[#010507] focus:border-[#BEC2FF] focus:outline-none focus:ring-2 focus:ring-[#BEC2FF33]"
      />
    </label>
  );
}

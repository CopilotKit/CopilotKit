"use client";

import React from "react";
import { CopilotChat } from "@copilotkit/react-core/v2";

import { ConfigCard } from "./config-card";
import type { AgentConfig } from "./config-types";

interface DemoLayoutProps {
  config: AgentConfig;
  onToneChange: (tone: AgentConfig["tone"]) => void;
  onExpertiseChange: (expertise: AgentConfig["expertise"]) => void;
  onResponseLengthChange: (length: AgentConfig["responseLength"]) => void;
}

export function DemoLayout({
  config,
  onToneChange,
  onExpertiseChange,
  onResponseLengthChange,
}: DemoLayoutProps) {
  return (
    <div className="flex h-screen flex-col gap-3 p-6">
      <ConfigCard
        config={config}
        onToneChange={onToneChange}
        onExpertiseChange={onExpertiseChange}
        onResponseLengthChange={onResponseLengthChange}
      />
      <div className="flex-1 overflow-hidden rounded-md border border-[var(--border)]">
        <CopilotChat
          agentId="agent-config-demo"
          className="h-full rounded-md"
        />
      </div>
    </div>
  );
}

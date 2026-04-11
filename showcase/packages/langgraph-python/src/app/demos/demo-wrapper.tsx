"use client";

import React, { useEffect } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { DemoErrorBoundary } from "./error-boundary";

interface DemoWrapperProps {
  demoName: string;
  agentId: string;
  children: React.ReactNode;
}

export function DemoWrapper({ demoName, agentId, children }: DemoWrapperProps) {
  useEffect(() => {
    console.log(`[${agentId}] Demo mounted: ${demoName}`);
    console.log(`[${agentId}] Runtime URL: /api/copilotkit`);
    console.log(`[${agentId}] Agent ID: ${agentId}`);
    console.log(`[${agentId}] Timestamp: ${new Date().toISOString()}`);

    return () => {
      console.log(`[${agentId}] Demo unmounted: ${demoName}`);
    };
  }, [demoName, agentId]);

  return (
    <DemoErrorBoundary demoName={demoName}>
      <CopilotKit
        runtimeUrl="/api/copilotkit"
        agent={agentId}
        onError={(error) => {
          console.error(`[${agentId}] CopilotKit error:`, error);
        }}
      >
        {children}
      </CopilotKit>
    </DemoErrorBoundary>
  );
}

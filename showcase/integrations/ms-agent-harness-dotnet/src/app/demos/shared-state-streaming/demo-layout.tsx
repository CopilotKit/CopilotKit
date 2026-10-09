"use client";

import React from "react";
import { CopilotSidebar } from "@copilotkit/react-core/v2";

import { DocumentView } from "./document-view";

interface DemoLayoutProps {
  document: string;
  isStreaming: boolean;
}

export function DemoLayout({ document, isStreaming }: DemoLayoutProps) {
  return (
    <div className="h-screen w-full bg-gray-50">
      <main className="flex h-full min-h-0 flex-col p-4">
        <DocumentView content={document} isStreaming={isStreaming} />
      </main>
      <CopilotSidebar
        agentId="shared-state-streaming"
        defaultOpen={true}
        labels={{
          chatInputPlaceholder: "Ask me to write something...",
        }}
      />
    </div>
  );
}

"use client";

import React from "react";
import { CopilotSidebar } from "@copilotkit/react-core/v2";

import { DocumentView } from "./document-view";

interface DemoLayoutProps {
  document: string;
  isStreaming: boolean;
  /** Set when the backend cannot stream the document token by token. */
  unsupportedNotice?: string;
}

export function DemoLayout({
  document,
  isStreaming,
  unsupportedNotice,
}: DemoLayoutProps) {
  return (
    <div className="h-screen w-full bg-gray-50 dark:bg-background">
      <main className="flex h-full min-h-0 flex-col p-4">
        <DocumentView
          content={document}
          isStreaming={isStreaming}
          unsupportedNotice={unsupportedNotice}
        />
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

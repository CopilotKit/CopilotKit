"use client";

import React from "react";
import { CopilotChat } from "@copilotkit/react-core/v2";

import { DocumentView } from "./document-view";

interface DemoLayoutProps {
  document: string;
  isStreaming: boolean;
}

export function DemoLayout({ document, isStreaming }: DemoLayoutProps) {
  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-gray-50">
      <section className="flex-1 min-h-0 p-4">
        <DocumentView content={document} isStreaming={isStreaming} />
      </section>
      <aside className="md:w-[420px] md:shrink-0 flex flex-col min-h-0 bg-white">
        <CopilotChat
          agentId="shared-state-streaming"
          className="flex-1 min-h-0"
          labels={{
            chatInputPlaceholder: "Ask me to write something...",
          }}
        />
      </aside>
    </div>
  );
}

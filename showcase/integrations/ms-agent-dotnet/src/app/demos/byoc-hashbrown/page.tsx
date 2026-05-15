"use client";

/**
 * byoc-hashbrown demo page.
 *
 * Streaming structured output from the .NET agent is parsed progressively
 * by `@hashbrownai/react`'s `useJsonParser` + `useUiKit` and rendered with
 * MetricCard + PieChart + BarChart from `./charts/`.
 *
 * Runtime: dedicated endpoint `/api/copilotkit-byoc-hashbrown` proxying
 * to the .NET agent at `/byoc-hashbrown`.
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  CopilotChatAssistantMessage,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import {
  HashBrownDashboard,
  useHashBrownMessageRenderer,
} from "./hashbrown-renderer";
import { BYOC_HASHBROWN_SUGGESTIONS } from "./suggestions";

export default function ByocHashbrownDemoPage() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-byoc-hashbrown"
      agent="byoc-hashbrown-demo"
    >
      <HashBrownDashboard>
        <div className="flex h-screen flex-col gap-3 p-6">
          <header>
            <h1 className="text-lg font-semibold">BYOC: Hashbrown</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Streaming structured output via <code>@hashbrownai/react</code>.
              The agent emits a catalog-constrained UI envelope that renders
              progressively as data streams.
            </p>
          </header>
          <div className="flex-1 overflow-hidden rounded-md border border-[var(--border)]">
            <ChatBody />
          </div>
        </div>
      </HashBrownDashboard>
    </CopilotKit>
  );
}

function ChatBody() {
  useConfigureSuggestions({
    suggestions: BYOC_HASHBROWN_SUGGESTIONS.map((s) => ({
      title: s.label,
      message: s.prompt,
      className: `byoc-hashbrown-suggestion-${s.label
        .toLowerCase()
        .replace(/\s+/g, "-")}`,
    })),
    available: "always",
  });

  const HashBrownMessage = useHashBrownMessageRenderer();

  return (
    <CopilotChat
      className="h-full"
      messageView={{
        assistantMessage:
          HashBrownMessage as unknown as typeof CopilotChatAssistantMessage,
      }}
    />
  );
}

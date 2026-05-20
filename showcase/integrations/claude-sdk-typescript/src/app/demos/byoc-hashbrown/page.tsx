"use client";

/**
 * byoc-hashbrown demo — Claude Agent SDK (TypeScript) port.
 *
 * Dedicated demo that ports the hashbrown renderer onto the Claude agent
 * backend. Streaming structured output from Claude (system-prompted to emit
 * hashbrown-shaped `{ ui: [ ... ] }` JSON) is parsed progressively by
 * `@hashbrownai/react`'s `useJsonParser` + `useUiKit` and rendered with
 * MetricCard + PieChart + BarChart from `./charts/`.
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
              Claude emits a catalog-constrained UI envelope that renders
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

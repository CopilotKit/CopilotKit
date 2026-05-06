"use client";

/**
 * byoc-hashbrown demo page (unified nextjs shell, Wave 2).
 *
 * Dedicated single-mode demo that ports the hashbrown renderer onto a
 * Strands agent. Streaming structured output from the agent (served at
 * `/api/<framework>/byoc-hashbrown`) is parsed progressively by
 * `@hashbrownai/react`'s `useJsonParser` + `useUiKit` and rendered with
 * MetricCard + PieChart + BarChart from `./charts/`.
 *
 * The system prompt is baked into the dedicated backend factory
 * (`src/agents/byoc_hashbrown.py`). No frontend prompt injection needed.
 */

import React, { use } from "react";
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

const DEMO_ID = "byoc-hashbrown";

export default function ByocHashbrownDemoPage({
  params,
}: {
  params: Promise<{ framework: string }>;
}) {
  const { framework } = use(params);
  return (
    <CopilotKit
      runtimeUrl={`/api/${framework}/${DEMO_ID}`}
      agent={DEMO_ID}
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

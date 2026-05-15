"use client";

/**
 * byoc-hashbrown demo page on Spring AI.
 *
 * Ports the hashbrown renderer onto a Spring AI agent. Streaming output from
 * the Spring agent is parsed progressively by `@hashbrownai/react`'s
 * `useJsonParser` + `useUiKit` and rendered with MetricCard + PieChart +
 * BarChart from `./charts/`.
 *
 * Caveat: Spring AI's `BeanOutputConverter` resolves on the FINAL response,
 * but `ChatClient.stream()` streams text tokens. This demo prompts the agent
 * to emit hashbrown-shaped JSON in its content; the parser handles partial
 * tokens defensively. Per-token schema-conformant streaming a la
 * LangGraph's `with_structured_output` is not available — see PARITY_NOTES.md.
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
    <CopilotKit runtimeUrl="/api/copilotkit" agent="byoc-hashbrown">
      <HashBrownDashboard>
        <div className="flex h-screen flex-col gap-3 p-6">
          <header>
            <h1 className="text-lg font-semibold">BYOC: Hashbrown</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Streaming structured output via <code>@hashbrownai/react</code>.
              The agent emits a catalog-constrained UI envelope that renders
              progressively as the Spring-AI ChatClient streams.
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

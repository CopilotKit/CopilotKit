"use client";

/**
 * byoc-hashbrown demo page (Wave 4a).
 *
 * Dedicated single-mode demo that ports the starter's hashbrown renderer
 * onto a langgraph-python agent. Streaming structured output from the agent
 * (`byoc_hashbrown_agent`) is parsed progressively by `@hashbrownai/react`'s
 * `useJsonParser` + `useUiKit` and rendered with MetricCard + PieChart +
 * BarChart from `./charts/`.
 *
 * Layout:
 * - Header with title + short description.
 * - Chat composer with pre-seeded suggestion pills (via
 *   `useConfigureSuggestions`). Clicking a pill sends the canned prompt.
 * - Assistant messages are routed through `HashBrownAssistantMessage` via
 *   `<CopilotChat messageView={{ assistantMessage: ... }} />`.
 *
 * Runtime: dedicated endpoint `/api/copilotkit-byoc-hashbrown` with its own
 * agent — no bleed into the default runtime.
 */

import React from "react";
import {
  CopilotKitProvider,
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
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit-byoc-hashbrown"
      useSingleEndpoint
    >
      <HashBrownDashboard>
        <div className="flex h-screen flex-col gap-3 p-6">
          <header>
            <h1 className="text-lg font-semibold">BYOC: Hashbrown</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Streaming structured output via <code>@hashbrownai/react</code>.
              The agent emits a catalog- constrained UI envelope that renders
              progressively as data streams.
            </p>
          </header>
          <div className="flex-1 overflow-hidden rounded-md border border-[var(--border)]">
            <ChatBody />
          </div>
        </div>
      </HashBrownDashboard>
    </CopilotKitProvider>
  );
}

function ChatBody() {
  // Pre-seed the composer with canonical prompts that steer the agent toward
  // hashbrown-shaped output. `useConfigureSuggestions` renders pills inside
  // the CopilotChat composer; clicking a pill sends its `message` directly.
  useConfigureSuggestions({
    suggestions: BYOC_HASHBROWN_SUGGESTIONS.map((s) => ({
      title: s.label,
      message: s.prompt,
      // E2E testid-friendly class — Playwright targets visible text, but we
      // keep a class hook in case we need finer-grained selectors later.
      className: `byoc-hashbrown-suggestion-${s.label
        .toLowerCase()
        .replace(/\s+/g, "-")}`,
    })),
    available: "always",
  });

  // Resolve the memoized HashBrownRenderMessage component from the kit
  // provider. It consumes the shared kit via context (see
  // hashbrown-renderer.tsx) and renders assistant messages as a progressively
  // assembled UI catalog.
  const HashBrownMessage = useHashBrownMessageRenderer();

  return (
    <CopilotChat
      className="h-full"
      messageView={{
        // `HashBrownMessage` matches the RenderMessage slot shape ({ message })
        // but the v2 assistantMessage slot expects CopilotChatAssistantMessage's
        // wider props. The cast is intentional — the renderer reads only
        // `message`, exactly like the starter's page does with `RenderMessage`
        // on CopilotSidebar.
        assistantMessage:
          HashBrownMessage as unknown as typeof CopilotChatAssistantMessage,
      }}
    />
  );
}

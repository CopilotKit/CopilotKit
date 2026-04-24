"use client";

/**
 * byoc-hashbrown demo page (Strands, Wave 2).
 *
 * Dedicated single-mode demo that ports the starter's hashbrown renderer
 * onto a Strands agent. Streaming structured output from the agent (served
 * at `/api/copilotkit-byoc-hashbrown`) is parsed progressively by
 * `@hashbrownai/react`'s `useJsonParser` + `useUiKit` and rendered with
 * MetricCard + PieChart + BarChart from `./charts/`.
 *
 * The Strands backend is the shared agent (agent_server.py). The
 * byoc-hashbrown-specific behavior — emitting the hashbrown JSON envelope —
 * is enforced via the `instructions` prop passed through CopilotKit, which
 * the ag-ui HttpAgent forwards to the Strands agent as a run-level prompt.
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  CopilotChatAssistantMessage,
  useConfigureSuggestions,
  useAgentContext,
} from "@copilotkit/react-core/v2";
import {
  HashBrownDashboard,
  useHashBrownMessageRenderer,
} from "./hashbrown-renderer";
import { BYOC_HASHBROWN_SUGGESTIONS } from "./suggestions";

/**
 * The hashbrown JSON envelope the frontend's `useJsonParser` expects. Injected
 * into the shared Strands agent as agent context so the LLM emits the right
 * shape without requiring a dedicated Strands Agent instance on the backend.
 *
 * See `src/agents/byoc_hashbrown.py` for the canonical system prompt; the
 * text below mirrors it verbatim so the two stay in sync.
 */
const BYOC_HASHBROWN_INSTRUCTIONS = `
You are a sales analytics assistant that replies by emitting a single JSON
object consumed by a streaming JSON parser on the frontend.

ALWAYS respond with a single JSON object of the form:

{
  "ui": [
    { <componentName>: { "props": { ... } } },
    ...
  ]
}

Do NOT wrap the response in code fences. Do NOT include any preface or
explanation outside the JSON object. The response MUST be valid JSON.

Available components and their prop schemas:

- "metric": { "props": { "label": string, "value": string } }
    A KPI card. value is a pre-formatted string like "$1.2M" or "248".

- "pieChart": { "props": { "title": string, "data": string } }
    A donut chart. data is a JSON-encoded STRING (embedded JSON) of an
    array of {label, value} objects with at least 3 segments.

- "barChart": { "props": { "title": string, "data": string } }
    A vertical bar chart. data is a JSON-encoded STRING of an array of
    {label, value} objects with at least 3 bars, typically time-ordered.

- "dealCard": { "props": { "title": string, "stage": string, "value": number } }
    A single sales deal. stage MUST be one of: prospect, qualified,
    proposal, negotiation, closed-won, closed-lost. value is a
    raw number.

- "Markdown": { "props": { "children": string } }
    Short explanatory text for section headings.

Rules:
- Always produce plausible sample data; do not refuse for lack of data.
- Prefer 3-6 rows of data in charts; keep labels short.
- Do not emit components that are not listed above.
- data props on charts MUST be a JSON STRING -- escape inner quotes.
`.trim();

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
  // Inject the hashbrown JSON envelope instruction as agent context so the
  // shared Strands backend LLM emits the right shape. useAgentContext
  // forwards this to the agent via AG-UI's context channel.
  useAgentContext({
    description: "byoc-hashbrown output contract",
    value: BYOC_HASHBROWN_INSTRUCTIONS,
  });

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

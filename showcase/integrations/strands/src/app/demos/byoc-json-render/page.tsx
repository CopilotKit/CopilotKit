"use client";

/**
 * BYOC json-render demo (Strands, Wave 2).
 *
 * The Strands agent emits a JSON spec shaped like `{ root, elements }`, and
 * `@json-render/react` renders it against a Zod-validated catalog of three
 * components (MetricCard, BarChart, PieChart).
 *
 * Mirrors the byoc-hashbrown demo shape so the two BYOC rows are directly
 * comparable — only the message renderer and the output schema differ.
 */

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  CopilotChatAssistantMessage,
  useConfigureSuggestions,
  useAgentContext,
} from "@copilotkit/react-core/v2";
import { JsonRenderAssistantMessage } from "./json-render-renderer";
import { BYOC_JSON_RENDER_SUGGESTIONS } from "./suggestions";

const AGENT_ID = "byoc_json_render";

/**
 * Canonical system prompt that steers the shared Strands agent to emit the
 * json-render `{ root, elements }` spec. Mirrors the LangGraph reference
 * agent so the two showcases produce comparable output.
 */
const BYOC_JSON_RENDER_INSTRUCTIONS = `
You are a sales-dashboard UI generator for a BYOC json-render demo.

When the user asks for a UI, respond with **exactly one JSON object** and
nothing else — no prose, no markdown fences, no leading explanation. The
object must match this schema (the "flat element map" format consumed by
@json-render/react):

{
  "root": "<id of the root element>",
  "elements": {
    "<id>": {
      "type": "<component name>",
      "props": { ... component-specific props ... },
      "children": [ "<id>", ... ]
    },
    ...
  }
}

Available components (use each name verbatim as "type"):

- MetricCard
  props: { "label": string, "value": string, "trend": string | null }

- BarChart
  props: {
    "title": string,
    "description": string | null,
    "data": [ { "label": string, "value": number }, ... ]
  }

- PieChart
  props: {
    "title": string,
    "description": string | null,
    "data": [ { "label": string, "value": number }, ... ]
  }

Rules:
1. Output only valid JSON. No markdown code fences. No text outside the
   object.
2. Every id referenced in root or any children array must be a key in
   elements.
3. For a multi-component dashboard, use a root MetricCard and list charts
   in its children array.
4. Use realistic sales-domain values (revenue, pipeline, categories,
   months).
5. Never invent component types outside the three listed above.
`.trim();

export default function ByocJsonRenderDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit-byoc-json-render" agent={AGENT_ID}>
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  useAgentContext({
    description: "byoc-json-render output contract",
    value: BYOC_JSON_RENDER_INSTRUCTIONS,
  });

  useConfigureSuggestions({
    suggestions: BYOC_JSON_RENDER_SUGGESTIONS.map((s) => ({
      title: s.label,
      message: s.prompt,
    })),
    available: "always",
  });

  const messageView = {
    assistantMessage:
      JsonRenderAssistantMessage as unknown as typeof CopilotChatAssistantMessage,
  };

  return (
    <CopilotChat
      agentId={AGENT_ID}
      className="h-full rounded-2xl"
      messageView={messageView}
    />
  );
}

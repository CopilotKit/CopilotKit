import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

const SYSTEM_PROMPT = `\
You are a sales-dashboard UI generator for a BYOC json-render demo.

When the user asks for a UI, respond with **exactly one JSON object** and
nothing else — no prose, no markdown fences, no leading explanation. The
object must match this schema (the "flat element map" format consumed by
\`@json-render/react\`):

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
  Example trend strings: "+12% vs last quarter", "-3% vs last month", null.

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

1. Output **only** valid JSON. No markdown code fences. No text outside
   the object.
2. Every id referenced in \`root\` or any \`children\` array must be a key
   in \`elements\`.
3. For a multi-component dashboard, use a root MetricCard and list the
   charts in its \`children\` array, OR pick any element as root and list
   the others as its children. Do not emit orphan elements.
4. Use realistic sales-domain values (revenue, pipeline, conversion,
   categories, months) — the demo is a sales dashboard.
5. \`children\` is optional but when present must be an array of strings.
6. Never invent component types outside the three listed above.

### Worked example — "Show me the sales dashboard with metrics and a revenue chart"

{
  "root": "revenue-metric",
  "elements": {
    "revenue-metric": {
      "type": "MetricCard",
      "props": {
        "label": "Revenue (Q3)",
        "value": "$1.24M",
        "trend": "+18% vs Q2"
      },
      "children": ["revenue-bar"]
    },
    "revenue-bar": {
      "type": "BarChart",
      "props": {
        "title": "Monthly revenue",
        "description": "Revenue by month across Q3",
        "data": [
          { "label": "Jul", "value": 380000 },
          { "label": "Aug", "value": 410000 },
          { "label": "Sep", "value": 450000 }
        ]
      }
    }
  }
}

Respond with the JSON object only.
`;

/**
 * Convert a TanStack AI stream to AG-UI events for a tool-free agent.
 *
 * Uses `type: "custom"` instead of `type: "tanstack"` to bypass the
 * runtime's `convertTanStackStream` which has a `runFinished` flag
 * (PR #4476) that blocks events after the first RUN_FINISHED.
 */
async function* convertStream(
  stream: AsyncIterable<unknown>,
  abortSignal: AbortSignal,
): AsyncGenerator<BaseEvent> {
  const messageId = crypto.randomUUID();

  for await (const chunk of stream) {
    if (abortSignal.aborted) break;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = chunk as any;
    const type = raw.type as string;

    if (type === "RUN_FINISHED") continue;

    if (type === "TEXT_MESSAGE_CONTENT" && raw.delta != null) {
      yield {
        type: EventType.TEXT_MESSAGE_CHUNK,
        role: "assistant",
        messageId,
        delta: raw.delta as string,
      };
    }
  }
}

/**
 * Built-in agent for the BYOC json-render demo. Uses a system prompt that
 * instructs the model to emit only valid JSON matching the json-render
 * flat-element-map schema.
 *
 * Uses `type: "custom"` with a dedicated stream converter to avoid the
 * runtime's `convertTanStackStream` runFinished-flag issue, matching the
 * pattern used by the main built-in-agent factory (tanstack-factory.ts).
 *
 * NOTE: `response_format: { type: "json_object" }` was removed from
 * modelOptions because TanStack AI's OpenAI adapter v0.8.x uses the
 * Responses API (`client.responses.create()`), not the Chat Completions
 * API. The Responses API does not support `response_format` — it uses
 * `text.format` instead. The system prompt already enforces JSON-only
 * output.
 */
export function createByocJsonRenderAgent() {
  return new BuiltInAgent({
    type: "custom",
    factory: async ({ input, abortController }) => {
      const { messages, systemPrompts } = convertInputToTanStackAI(input);

      const stream = chat({
        adapter: openaiText("gpt-4o-mini"),
        messages,
        systemPrompts: [SYSTEM_PROMPT, ...systemPrompts],
        tools: [],
        modelOptions: {
          temperature: 0.2,
        },
        abortController,
      });

      return convertStream(stream, abortController.signal);
    },
  });
}

import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";

const BYOC_HASHBROWN_SYSTEM_PROMPT = `\
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
    A KPI card. \`value\` is a pre-formatted string like "$1.2M" or "248".

- "pieChart": { "props": { "title": string, "data": string } }
    A donut chart. \`data\` is a JSON-encoded STRING (embedded JSON) of an
    array of {label, value} objects with at least 3 segments.

- "barChart": { "props": { "title": string, "data": string } }
    A vertical bar chart. \`data\` is a JSON-encoded STRING of an array of
    {label, value} objects with at least 3 bars, typically time-ordered.

- "dealCard": { "props": { "title": string, "stage": string, "value": number } }
    A single sales deal. \`stage\` MUST be one of: "prospect", "qualified",
    "proposal", "negotiation", "closed-won", "closed-lost". \`value\` is a
    raw number (no currency symbol or comma).

- "Markdown": { "props": { "children": string } }
    Short explanatory text. Use for section headings and brief summaries.
    Standard markdown is supported in \`children\`.

Rules:
- Always produce plausible sample data when the user asks for a dashboard or
  chart — do not refuse for lack of data.
- Prefer 3-6 rows of data in charts; keep labels short.
- Use "Markdown" for short headings or linking sentences between visual
  components. Do not emit long prose.
- Do not emit components that are not listed above.
- \`data\` props on charts MUST be a JSON STRING — escape inner quotes.

Example response (sales dashboard):
{"ui":[{"Markdown":{"props":{"children":"## Q4 Sales Summary"}}},{"metric":{"props":{"label":"Total Revenue","value":"$1.2M"}}},{"pieChart":{"props":{"title":"Revenue by Segment","data":"[{\\"label\\":\\"Enterprise\\",\\"value\\":600000},{\\"label\\":\\"SMB\\",\\"value\\":400000},{\\"label\\":\\"Startup\\",\\"value\\":200000}]"}}}]}
`;

/**
 * Convert a TanStack AI stream to AG-UI events for a tool-free agent.
 *
 * Uses `type: "custom"` instead of `type: "tanstack"` to bypass the
 * runtime's `convertTanStackStream` which has a `runFinished` flag
 * (PR #4476) that blocks events after the first RUN_FINISHED. This
 * converter simply skips RUN_FINISHED and forwards text events.
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

    // Skip RUN_FINISHED from TanStack's adapter — the Agent class emits
    // its own lifecycle events.
    if (type === "RUN_FINISHED") continue;

    if (type === "TEXT_MESSAGE_CONTENT" && raw.delta != null) {
      yield {
        type: EventType.TEXT_MESSAGE_CHUNK,
        role: "assistant",
        messageId,
        delta: raw.delta as string,
      };
    }
    // No tool handling needed — this agent has no tools.
  }
}

/**
 * Built-in agent for the BYOC hashbrown demo. Uses a sales-dashboard
 * system prompt that instructs the model to emit only valid JSON.
 *
 * Uses `type: "custom"` with a dedicated stream converter to avoid the
 * runtime's `convertTanStackStream` runFinished-flag issue, matching the
 * pattern used by the main built-in-agent factory (tanstack-factory.ts).
 *
 * NOTE: `response_format: { type: "json_object" }` was removed from
 * modelOptions because TanStack AI's OpenAI adapter v0.8.x uses the
 * Responses API (`client.responses.create()`), not the Chat Completions
 * API. The Responses API does not support `response_format` — it uses
 * `text.format` instead. Passing `response_format` to the Responses API
 * can cause silent failures or rejected requests. The system prompt
 * already enforces JSON-only output.
 */
export function createByocHashbrownAgent() {
  return new BuiltInAgent({
    type: "custom",
    factory: async ({ input, abortController }) => {
      const { messages, systemPrompts } = convertInputToTanStackAI(input);

      const stream = chat({
        adapter: openaiText("gpt-4o-mini"),
        messages,
        systemPrompts: [BYOC_HASHBROWN_SYSTEM_PROMPT, ...systemPrompts],
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

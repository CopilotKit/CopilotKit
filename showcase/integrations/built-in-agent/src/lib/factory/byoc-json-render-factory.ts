import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import type { TanStackChatMessage } from "@copilotkit/runtime/v2";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
// Custom fetch that injects ALS-bound inbound x-* headers (e.g.
// x-aimock-context) onto every outbound OpenAI call. Required so aimock
// can match fixtures by integration context. See ../header-forwarding.ts
// for the full rationale; mirrors the Mastra precedent.
import { forwardingFetch } from "../header-forwarding";
import { DEMO_AGENT_LOOP_STRATEGY, throwOnRunError } from "./demo-stream";

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
 * Responses-API JSON mode, the equivalent of Chat Completions'
 * `response_format: { type: "json_object" }`.
 *
 * `modelOptions` is spread verbatim into the `client.responses.create()` body
 * by `@tanstack/openai-base`'s `mapOptionsToRequest` (verified against the
 * pinned `@tanstack/ai-openai@0.15.6` → `@tanstack/openai-base@0.9.2`), and its
 * `validateTextProviderOptions` only inspects `metadata` / `conversation` /
 * `previous_response_id`, so `text` passes through untouched. The adapter sets
 * `text.format` itself ONLY when an `outputSchema` is passed to `chat()`; none
 * is here, so there is nothing to clobber.
 *
 * Deliberately `json_object` (syntactic validity) rather than a strict
 * `json_schema`: the spec is a recursive element map keyed by arbitrary element
 * ids, which `strict: true` cannot express without an `additionalProperties`
 * escape hatch. Syntactic validity is the whole defect — the model's *content*
 * was always right, only its final brace was missing — and it is exactly what
 * the reference enforces. `parseSpec` in `json-render-renderer.tsx` still
 * validates the shape on the client.
 *
 * MUST be paired with `JSON_MODE_INPUT_DIRECTIVE` below. `json_object` has a
 * server-side precondition that is easy to miss: the word "json" has to appear
 * in the request's `input`, and this adapter sends `systemPrompts` as
 * `instructions`, NOT as input. With the JSON directive living only in
 * SYSTEM_PROMPT, real OpenAI rejected every run with
 *   400 "Response input messages must contain the word 'json' in some form to
 *        use 'text.format' of type 'json_object'."  (param: input)
 * and the demo rendered nothing at all. Verified against the live API with the
 * pinned adapter.
 */
const JSON_OBJECT_FORMAT = {
  text: { format: { type: "json_object" } },
} as const;

/**
 * Carries the JSON-only directive in the MESSAGE list (→ Responses API
 * `input`) rather than in `systemPrompts` (→ `instructions`), which is what
 * satisfies `json_object`'s "input must mention json" precondition documented
 * on `JSON_OBJECT_FORMAT`. The wording is deliberately redundant with
 * SYSTEM_PROMPT: the model needs the instruction, and the API needs the literal
 * token in `input`. Prepended so a later user turn can never displace it.
 *
 * `role: "user"` because `TanStackChatMessage` only admits
 * `user | assistant | tool` — the runtime deliberately hoists system/developer
 * messages out of the message list and into `systemPrompts`, which is the very
 * half that does NOT count as input here. It is invisible in the UI: the chat
 * renders from AG-UI events, not from what the backend sends the model.
 */
const JSON_MODE_INPUT_DIRECTIVE: TanStackChatMessage = {
  role: "user",
  content:
    "Respond with a single valid JSON object and nothing else. Output JSON only.",
};

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

    // Fail loud on an upstream rejection — see ./demo-stream.
    throwOnRunError(raw);

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
 * JSON validity is enforced at the MODEL, via the Responses API's
 * `text.format` (see `JSON_OBJECT_FORMAT` below) — not by the system prompt
 * alone. `response_format: { type: "json_object" }` was once removed from
 * modelOptions on the grounds that the Responses API doesn't accept it and
 * "the system prompt already enforces JSON-only output". It does not: without
 * model-level enforcement the model reliably under-closed the object by one
 * brace on any prompt it couldn't crib from the worked example below, and
 * `<Renderer />` — correctly requiring a balanced object — fell back to
 * dumping the raw JSON into the chat bubble. The reference keeps the same
 * enforcement (`byoc_json_render_agent.py`:
 * `model_kwargs={"response_format": {"type": "json_object"}}`).
 */
export function createByocJsonRenderAgent() {
  return new BuiltInAgent({
    type: "custom",
    factory: async ({ input, abortController }) => {
      const { messages, systemPrompts } = convertInputToTanStackAI(input);

      const stream = chat({
        adapter: openaiText("gpt-5.4", { fetch: forwardingFetch }),
        // JSON_MODE_INPUT_DIRECTIVE goes in `messages` (→ `input`), not in
        // `systemPrompts` (→ `instructions`) — that is the half `json_object`
        // validates against. See JSON_OBJECT_FORMAT.
        messages: [JSON_MODE_INPUT_DIRECTIVE, ...messages],
        systemPrompts: [SYSTEM_PROMPT, ...systemPrompts],
        tools: [],
        modelOptions: {
          temperature: 0.2,
          ...JSON_OBJECT_FORMAT,
        },
        abortController,
        agentLoopStrategy: DEMO_AGENT_LOOP_STRATEGY,
      });

      return convertStream(stream, abortController.signal);
    },
  });
}

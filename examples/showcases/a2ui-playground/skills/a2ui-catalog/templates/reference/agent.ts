// Reference implementation copied from the a2ui-playground build (working, measured).
// Paths like @/a2ui/... are app-specific: adapt imports to your project.
/**
 * The playground agent: a CopilotKit BuiltInAgent in custom-factory mode.
 *
 *   prompt ──▶ router (gpt-5.5) ──┬─▶ fixed tool: fetch real data ─▶ pre-authored template ─▶ ops
 *                                 └─▶ generate_a2ui ─▶ composer sub-agent (gpt-5.4-mini, streamed) ─▶ ops
 *
 * Everything is emitted as AG-UI events. Each surface is a Gen UI 2.0
 * `generative-ui-surface` activity carrying A2UI v1.0 operations
 * (`./surface.ts`): a fixed template paints its skeleton at tool pick and
 * fills in when the data lands; the composer appends one component at a time
 * while the model is still writing.
 *
 * The browser sends its catalog in the generative UI envelope
 * (`forwardedProps.copilotkit.ui`). The composer builds its prompt from it, and
 * a click on a surface arrives there as an A2UI 1.0 action.
 */
import OpenAI from "openai";
import type { Message, RunAgentInput } from "@ag-ui/client";
import {
  envelopeToManifest,
  readCopilotKitUIEnvelope,
} from "@copilotkit/shared";
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { compose, COMPOSER_MODEL, GENERATE_A2UI_TOOL_NAME } from "./composer";
import { EventQueue, EventType, pipeline, uid } from "./events";
import { SurfaceStream, type SurfaceRecord } from "./surface";
import { blueprintOf, TEMPLATE_TREES } from "./surfaces/templates";
import { DATA_TOOLS, FIXED_TOOLS, type ToolSpec } from "./tools";

export const ROUTER_MODEL = process.env.A2UI_ROUTER_MODEL ?? "gpt-5.5";

export type Mode = "auto" | "fixed" | "dynamic";

const GENERATE_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: GENERATE_A2UI_TOOL_NAME,
    description:
      "Compose a custom UI from the component catalog with a UI sub-agent. Use for anything no fixed tool covers: forms, comparisons, plans, dashboards, explainers. intent='update' changes an existing surface in place (pass target_surface_id).",
    parameters: {
      type: "object",
      properties: {
        brief: {
          type: "string",
          description:
            "One or two sentences: what UI to build and the key facts/data it must show.",
        },
        intent: { type: "string", enum: ["create", "update"] },
        target_surface_id: {
          type: "string",
          description:
            "For intent='update': the surface to change. Defaults to the clicked or last surface.",
        },
      },
      required: ["brief"],
    },
  },
};

function routerPrompt(mode: Mode) {
  const modeLine =
    mode === "fixed"
      ? "MODE fixed: only use the show_* tools. If none fits, reply in one short sentence suggesting a supported request (weather, places, route, currency, stock, flights, signup form, profile, receipt, event, recipe)."
      : mode === "dynamic"
        ? `MODE dynamic: always answer with ${GENERATE_A2UI_TOOL_NAME}. If the request needs live weather, places, a route or FX rates, call the matching get_* data tool(s) first in the same turn; the data is handed to the UI sub-agent automatically.`
        : `MODE auto: prefer a show_* tool whenever one fits (it is instant). Otherwise use ${GENERATE_A2UI_TOOL_NAME}, calling get_* data tools in the same turn when live data helps.`;
  return `You route requests in a generative UI playground. Every answer is UI rendered from tool calls.
${modeLine}
Rules: call tools immediately, no preamble text. One UI per turn. Never use em dashes.
A click on a surface arrives as a user message that names the action (with its context), sent from that surface. If the action REFINES what the surface shows (filter, sort, show more, toggle, change chart type, pick a tab or option, edit a value), call ${GENERATE_A2UI_TOOL_NAME} with intent "update" and target_surface_id set to that surface: it is updated in place. If the action SUBMITS or completes a step (signup, booking, RSVP, checkout), create a new surface such as a confirmation.
The user can also ask to change an existing surface ("make it a bar chart", "add a column"): that is intent "update" too.`;
}

/* ───────────────────────── history conversion ───────────────────────── */

/** What a tool result says about the surface it rendered: the agent reads it back to update that surface. */
type SurfaceResult = {
  surface: SurfaceRecord;
  updated?: boolean;
  template?: string;
};

function readSurfaceResult(content: string): SurfaceResult | undefined {
  try {
    const j = JSON.parse(content);
    if (
      j?.surface &&
      typeof j.surface.surfaceId === "string" &&
      Array.isArray(j.surface.components)
    )
      return j as SurfaceResult;
  } catch {
    /* plain text */
  }
  return undefined;
}

function summarizeToolContent(content: string) {
  const r = readSurfaceResult(content);
  if (r)
    return `${r.updated ? "Updated" : "Rendered"} surface "${r.surface.surfaceId}" with ${r.surface.components.length} components.`;
  return content.length > 1200 ? `${content.slice(0, 1200)}…` : content;
}

function toOpenAI(
  messages: Message[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const answered = new Set(
    messages
      .filter((m) => m.role === "tool")
      .map((m) => (m as { toolCallId: string }).toolCallId),
  );
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const c =
        typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      out.push({ role: "user", content: c });
    } else if (m.role === "assistant") {
      const calls = (m.toolCalls ?? []).filter((c) => answered.has(c.id));
      const text = typeof m.content === "string" ? m.content : "";
      if (!text && !calls.length) continue;
      out.push({
        role: "assistant",
        content: text || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: {
                  name: c.function.name,
                  arguments: c.function.arguments || "{}",
                },
              })),
            }
          : {}),
      });
    } else if (m.role === "tool") {
      const prev = out[out.length - 1];
      if (!prev || prev.role === "user" || prev.role === "system") continue;
      out.push({
        role: "tool",
        tool_call_id: m.toolCallId,
        content: summarizeToolContent(String(m.content ?? "")),
      });
    }
  }
  return out
    .slice(-16)
    .filter((m, i, arr) => !(i === 0 && m.role === "tool") || arr.length === 1);
}

function conversationText(messages: Message[]) {
  return messages
    .filter(
      (m) =>
        m.role === "user" ||
        (m.role === "assistant" &&
          typeof m.content === "string" &&
          m.content) ||
        m.role === "tool",
    )
    .slice(-8)
    .map(
      (m) =>
        `${m.role}: ${m.role === "tool" ? summarizeToolContent(String(m.content ?? "")) : typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`,
    )
    .join("\n");
}

/**
 * Finds a rendered surface in the history: the latest version of `surfaceId`
 * (or of the last surface when no id is given). An update writes to the same
 * surface id, so the card the user is looking at changes in place.
 */
function findSurface(
  messages: Message[],
  surfaceId?: string,
): SurfaceRecord | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "tool") continue;
    const r = readSurfaceResult(String(m.content));
    if (r && (!surfaceId || r.surface.surfaceId === surfaceId))
      return r.surface;
  }
  return undefined;
}

/* ───────────────────────── the run ───────────────────────── */

type PendingCall = { id: string; name: string; args: string };

async function run(input: RunAgentInput, signal: AbortSignal, q: EventQueue) {
  const t0 = performance.now();
  const client = new OpenAI();
  const props = (input.forwardedProps ?? {}) as { mode?: Mode };
  const mode: Mode =
    props.mode === "fixed" || props.mode === "dynamic" ? props.mode : "auto";
  const envelope = readCopilotKitUIEnvelope(input.forwardedProps);
  const manifest = envelope ? envelopeToManifest(envelope) : undefined;
  pipeline(q, t0, "run:start", {
    mode,
    router: ROUTER_MODEL,
    composer: COMPOSER_MODEL,
  });

  const tools: ToolSpec[] =
    mode === "fixed"
      ? FIXED_TOOLS
      : mode === "dynamic"
        ? DATA_TOOLS
        : [...FIXED_TOOLS, ...DATA_TOOLS];
  const toolDefs: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    ...tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    })),
    ...(mode === "fixed" ? [] : [GENERATE_TOOL]),
  ];

  pipeline(q, t0, "route:start", { model: ROUTER_MODEL });
  const stream = await client.chat.completions.create(
    {
      model: ROUTER_MODEL,
      stream: true,
      reasoning_effort: "none",
      parallel_tool_calls: true,
      tools: toolDefs,
      messages: [
        { role: "system", content: routerPrompt(mode) },
        ...toOpenAI(input.messages),
      ],
    },
    { signal },
  );

  const parentMessageId = uid();
  let textStarted = false;
  const calls = new Map<number, PendingCall>();
  for await (const chunk of stream) {
    const d = chunk.choices[0]?.delta;
    if (!d) continue;
    if (d.content) {
      if (!textStarted) {
        textStarted = true;
        q.push({
          type: EventType.TEXT_MESSAGE_START,
          messageId: parentMessageId,
          role: "assistant",
        });
      }
      q.push({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: parentMessageId,
        delta: d.content,
      });
    }
    for (const tc of d.tool_calls ?? []) {
      let c = calls.get(tc.index);
      if (!c) {
        c = { id: tc.id ?? uid(), name: tc.function?.name ?? "", args: "" };
        calls.set(tc.index, c);
        pipeline(q, t0, "route:decided", {
          tool: c.name,
          kind:
            c.name === GENERATE_A2UI_TOOL_NAME
              ? "dynamic"
              : c.name.startsWith("show_")
                ? "fixed"
                : "data",
        });
        q.push({
          type: EventType.TOOL_CALL_START,
          toolCallId: c.id,
          toolCallName: c.name,
          parentMessageId,
        });
        // Fixed schema: the tree is known now, before any data. Paint its blueprint immediately.
        const tree = TEMPLATE_TREES[c.name];
        if (tree) {
          new SurfaceStream(q, `${tree.template}-${c.id.slice(-6)}`).create(
            blueprintOf(tree.components),
          );
          pipeline(q, t0, "skeleton", {
            template: tree.template,
            components: tree.components.length,
          });
        }
      }
      if (tc.function?.arguments) {
        c.args += tc.function.arguments;
        q.push({
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: c.id,
          delta: tc.function.arguments,
        });
      }
    }
  }
  if (textStarted)
    q.push({ type: EventType.TEXT_MESSAGE_END, messageId: parentMessageId });
  for (const c of calls.values())
    q.push({ type: EventType.TOOL_CALL_END, toolCallId: c.id });

  const parsed = Array.from(calls.values()).map((c) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(c.args || "{}");
    } catch {
      /* leave empty */
    }
    return { ...c, parsed: args };
  });

  // 1) fixed tools: data only, the tree is pre-authored.
  const fixed = parsed.find((c) => c.name.startsWith("show_"));
  if (fixed) {
    const spec = FIXED_TOOLS.find((t) => t.name === fixed.name)!;
    pipeline(q, t0, "data:start", { tool: fixed.name });
    try {
      const surface = await spec.run!(fixed.parsed);
      pipeline(q, t0, "data:done", { source: surface.source });
      // The skeleton is on screen under this id: the data lands first, so every binding resolves as its component swaps in.
      const record: SurfaceRecord = {
        surfaceId: `${surface.template}-${fixed.id.slice(-6)}`,
        components: surface.components,
        data: {
          ...surface.data,
          _meta: { source: surface.source, template: surface.template },
        },
      };
      const stream = new SurfaceStream(q, record.surfaceId);
      stream.data(record.data);
      stream.upsert(...record.components);
      stream.close();
      q.push({
        type: EventType.TOOL_CALL_RESULT,
        messageId: uid(),
        toolCallId: fixed.id,
        role: "tool",
        content: JSON.stringify({
          surface: record,
          template: surface.template,
        } satisfies SurfaceResult),
      });
      pipeline(q, t0, "paint", {
        components: surface.components.length,
        progressive: false,
        template: surface.template,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      q.push({
        type: EventType.TOOL_CALL_RESULT,
        messageId: uid(),
        toolCallId: fixed.id,
        role: "tool",
        content: JSON.stringify({ error: message }),
      });
      // The skeleton is already on screen: replace it with the reason instead of leaving empty frames.
      const tree = TEMPLATE_TREES[fixed.name];
      if (tree) {
        const stream = new SurfaceStream(
          q,
          `${tree.template}-${fixed.id.slice(-6)}`,
        );
        stream.upsert({
          id: "root",
          component: "Alert",
          tone: "warning",
          title: "Could not load this",
          message: `${message}. Try a nearby city or a different wording.`,
        });
        stream.close();
      } else sayText(q, `I could not load that: ${message}.`);
      pipeline(q, t0, "error", { message });
    }
    for (const other of parsed.filter((c) => c !== fixed)) {
      q.push({
        type: EventType.TOOL_CALL_RESULT,
        messageId: uid(),
        toolCallId: other.id,
        role: "tool",
        content: JSON.stringify({ skipped: true }),
      });
    }
    pipeline(q, t0, "done");
    return;
  }

  // 2) data tools run in parallel; their results feed the composer directly.
  const dataCalls = parsed.filter((c) =>
    DATA_TOOLS.some((t) => t.name === c.name),
  );
  const fetched: Record<string, unknown> = {};
  if (dataCalls.length) {
    pipeline(q, t0, "data:start", { tools: dataCalls.map((c) => c.name) });
    await Promise.all(
      dataCalls.map(async (c) => {
        const spec = DATA_TOOLS.find((t) => t.name === c.name)!;
        let result: unknown;
        try {
          result = await spec.fetch!(c.parsed);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
        }
        fetched[`${c.name}:${JSON.stringify(c.parsed)}`] = result;
        q.push({
          type: EventType.TOOL_CALL_RESULT,
          messageId: uid(),
          toolCallId: c.id,
          role: "tool",
          content: JSON.stringify(result).slice(0, 4000),
        });
      }),
    );
    pipeline(q, t0, "data:done", { sources: dataCalls.map((c) => c.name) });
  }

  // 3) dynamic: the composer sub-agent writes the surface.
  let gen = parsed.find((c) => c.name === GENERATE_A2UI_TOOL_NAME);
  if (!gen && dataCalls.length) {
    // The router fetched data without composing; compose in the same run rather than paying for another router hop.
    gen = {
      id: uid(),
      name: GENERATE_A2UI_TOOL_NAME,
      args: "",
      parsed: {
        brief:
          "Present the fetched data as a rich UI that answers the user's last request.",
      },
    };
    pipeline(q, t0, "route:decided", {
      tool: gen.name,
      kind: "dynamic",
      synthesized: true,
    });
    q.push({
      type: EventType.TOOL_CALL_START,
      toolCallId: gen.id,
      toolCallName: gen.name,
      parentMessageId: uid(),
    });
    q.push({
      type: EventType.TOOL_CALL_ARGS,
      toolCallId: gen.id,
      delta: JSON.stringify(gen.parsed),
    });
    q.push({ type: EventType.TOOL_CALL_END, toolCallId: gen.id });
  }
  if (gen) {
    const clicked = manifest?.action?.action.surfaceId;
    const target =
      typeof gen.parsed.target_surface_id === "string"
        ? gen.parsed.target_surface_id
        : clicked;
    const prior =
      gen.parsed.intent === "update"
        ? (findSurface(input.messages, target) ?? findSurface(input.messages))
        : undefined;
    try {
      if (!manifest)
        throw new Error(
          "The request carries no generative UI catalog. Render the chat inside <CopilotKit generativeUI={{ ui }}>.",
        );
      const result = await compose({
        brief: String(
          gen.parsed.brief ?? "Build a UI for the user's last request.",
        ),
        conversation: conversationText(input.messages),
        data: dataCalls.length ? fetched : undefined,
        prior,
        manifest,
        toolCallId: gen.id,
        t0,
        q,
        client,
        signal,
      });
      if (prior)
        pipeline(q, t0, "paint", {
          components: result.components.length,
          progressive: false,
          updated: prior.surfaceId,
        });
      const record: SurfaceRecord = {
        surfaceId: result.surfaceId,
        components: result.components,
        data: result.data,
      };
      q.push({
        type: EventType.TOOL_CALL_RESULT,
        messageId: uid(),
        toolCallId: gen.id,
        role: "tool",
        content: JSON.stringify({
          surface: record,
          updated: !!prior,
        } satisfies SurfaceResult),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      q.push({
        type: EventType.TOOL_CALL_RESULT,
        messageId: uid(),
        toolCallId: gen.id,
        role: "tool",
        content: JSON.stringify({ error: message }),
      });
      pipeline(q, t0, "error", { message });
    }
  }
  pipeline(q, t0, "done");
}

function sayText(q: EventQueue, text: string) {
  const id = uid();
  q.push({
    type: EventType.TEXT_MESSAGE_START,
    messageId: id,
    role: "assistant",
  });
  q.push({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: id, delta: text });
  q.push({ type: EventType.TEXT_MESSAGE_END, messageId: id });
}

export function createPlaygroundAgent() {
  return new BuiltInAgent({
    type: "custom",
    factory: ({ input, abortSignal }) => {
      const q = new EventQueue();
      run(input, abortSignal, q)
        .catch((err) => {
          sayText(
            q,
            `Something went wrong: ${err instanceof Error ? err.message : String(err)}`,
          );
        })
        .finally(() => q.close());
      return q;
    },
  });
}

/**
 * The playground agent: a CopilotKit BuiltInAgent in custom-factory mode.
 *
 *   prompt ──▶ router ──┬─▶ fixed tool: fetch real data ─▶ pre-authored template ─▶ ops
 *                       └─▶ generate_a2ui ─▶ composer sub-agent (Express or JSON, streamed) ─▶ macros expand ─▶ ops
 *
 * The browser picks the model (Gemini Flash by default, a local Gemma, or
 * GPT; `./models.ts`) and the format the composer writes: A2UI Express (the
 * default, compiled by Google's `@a2ui/agent`) or A2UI JSON.
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
import { composeExpress } from "./compose-express";
import { compose, GENERATE_A2UI_TOOL_NAME } from "./composer";
import { EventQueue, EventType, pipeline, uid } from "./events";
import { SurfaceStream, type SurfaceRecord } from "./surface";
import { blueprintOf, TEMPLATE_TREES } from "./surfaces/templates";
import { modelOf } from "./models";
import { DATA_TOOLS, FIXED_TOOLS, type ToolSpec } from "./tools";
import {
  MAX_DATA_CALLS,
  MAX_HISTORY_CHARS,
  MAX_MESSAGES,
  MAX_PROMPT_CHARS,
  ROUTER_MAX_TOKENS,
} from "@/lib/limits";

export type Mode = "auto" | "fixed" | "dynamic";
export type Format = "express" | "json";

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

/**
 * What the agent reads of the chat the browser sends: the newest messages, each
 * user and assistant text cut to MAX_PROMPT_CHARS, so no visitor can make the
 * model's prompt as long as they like. Tool results are summarized or cut
 * where they reach a model, and `toOpenAI` caps the whole history.
 */
function clampHistory(messages: Message[]): Message[] {
  return messages.slice(-MAX_MESSAGES).map((m) => {
    if (m.role === "user")
      return {
        ...m,
        content: (typeof m.content === "string"
          ? m.content
          : JSON.stringify(m.content)
        ).slice(0, MAX_PROMPT_CHARS),
      };
    if (m.role === "assistant") {
      // Arguments over the cap are no real call: they become "{}", since cut JSON is refused by some providers.
      const toolCalls = m.toolCalls?.map((c) =>
        c.function.arguments.length > MAX_PROMPT_CHARS
          ? { ...c, function: { ...c.function, arguments: "{}" } }
          : c,
      );
      return {
        ...m,
        ...(typeof m.content === "string"
          ? { content: m.content.slice(0, MAX_PROMPT_CHARS) }
          : {}),
        ...(toolCalls ? { toolCalls } : {}),
      };
    }
    return m;
  });
}

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
  // The newest turns that fit in 16 messages and MAX_HISTORY_CHARS, cut only where a user message starts:
  // a cut inside a turn leaves a tool result without its call, which providers refuse with a 400.
  let from = out.length;
  for (let i = out.length - 1, size = 0; i >= 0; i--) {
    size += JSON.stringify(out[i]).length;
    if (out.length - i > 16 || size > MAX_HISTORY_CHARS) break;
    if (out[i].role === "user") from = i;
  }
  return out.slice(from);
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
  const props = (input.forwardedProps ?? {}) as {
    mode?: Mode;
    model?: string;
    format?: Format;
  };
  const mode: Mode =
    props.mode === "fixed" || props.mode === "dynamic" ? props.mode : "auto";
  const format: Format = props.format === "json" ? "json" : "express";
  const model = modelOf(props.model);
  const missing = model.missing();
  if (missing) {
    console.warn(`[playground] ${model.label} cannot run: ${model.setup}`);
    fail(
      q,
      t0,
      `${model.label} isn't available here right now. Try another model.`,
      missing,
    );
    return;
  }
  const client = model.client();
  const messages = clampHistory(input.messages);
  const envelope = readCopilotKitUIEnvelope(input.forwardedProps);
  const manifest = envelope ? envelopeToManifest(envelope) : undefined;
  pipeline(q, t0, "run:start", {
    mode,
    model: model.id,
    router: model.router,
    composer: model.composer,
    format,
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

  pipeline(q, t0, "route:start", { model: model.router });
  const stream = await client.chat.completions.create(
    {
      model: model.router,
      stream: true,
      ...model.extra,
      ...model.maxTokens(ROUTER_MAX_TOKENS),
      ...(model.parallelToolCalls ? { parallel_tool_calls: true } : {}),
      tools: toolDefs,
      messages: [
        { role: "system", content: routerPrompt(mode) },
        ...toOpenAI(messages),
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
        // Fixed schema: the tree is known now, before any data. Paint its blueprint immediately,
        // for the first show_* call only: that is the one that runs, and another skeleton would stay empty.
        const tree = TEMPLATE_TREES[c.name];
        if (
          tree &&
          [...calls.values()].find((o) => o.name.startsWith("show_")) === c
        ) {
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
      const surface = await spec.run!(fixed.parsed, signal);
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
      // A stopped run ends quietly (the factory ignores aborted runs) instead of drawing an error card.
      if (signal.aborted) throw err;
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

  // 2) data tools run in parallel; their results feed the composer directly. Calls past MAX_DATA_CALLS are skipped.
  const dataCalls = parsed.filter((c) =>
    DATA_TOOLS.some((t) => t.name === c.name),
  );
  for (const c of dataCalls.splice(MAX_DATA_CALLS))
    q.push({
      type: EventType.TOOL_CALL_RESULT,
      messageId: uid(),
      toolCallId: c.id,
      role: "tool",
      content: JSON.stringify({ skipped: true }),
    });
  const fetched: Record<string, unknown> = {};
  if (dataCalls.length) {
    pipeline(q, t0, "data:start", { tools: dataCalls.map((c) => c.name) });
    await Promise.all(
      dataCalls.map(async (c) => {
        const spec = DATA_TOOLS.find((t) => t.name === c.name)!;
        let result: unknown;
        try {
          result = await spec.fetch!(c.parsed, signal);
        } catch (err) {
          // Stop is not a data error for the composer to explain.
          if (signal.aborted) throw err;
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
    const named =
      typeof gen.parsed.target_surface_id === "string"
        ? gen.parsed.target_surface_id
        : undefined;
    // An update changes the surface it names, else the one clicked, and the newest only when neither is given:
    // a named or clicked surface that is not in the chat gets a new surface instead of rewriting another one.
    const ids = [named, clicked].filter((id): id is string => !!id);
    const prior =
      gen.parsed.intent !== "update"
        ? undefined
        : ids.length
          ? ids.map((id) => findSurface(messages, id)).find(Boolean)
          : findSurface(messages);
    try {
      if (!manifest)
        throw new Error(
          "The request carries no generative UI catalog. Render the chat inside <CopilotKit generativeUI={{ ui }}>.",
        );
      const result = await (format === "express" ? composeExpress : compose)({
        brief: String(
          gen.parsed.brief ?? "Build a UI for the user's last request.",
        ),
        conversation: conversationText(messages),
        data: dataCalls.length ? fetched : undefined,
        prior,
        manifest,
        toolCallId: gen.id,
        t0,
        q,
        model,
        client,
        signal,
      });
      // Nothing to show (a new surface with no root, an update with neither components nor data) fails the run instead of ending it done.
      if (
        prior
          ? !result.components.length && !Object.keys(result.data).length
          : !result.components.some((c) => c.id === "root")
      )
        throw new Error(
          prior
            ? "The model wrote nothing for this update."
            : "The model wrote no root component.",
        );
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
      if (signal.aborted) throw err;
      const message = err instanceof Error ? err.message : String(err);
      q.push({
        type: EventType.TOOL_CALL_RESULT,
        messageId: uid(),
        toolCallId: gen.id,
        role: "tool",
        content: JSON.stringify({ error: message }),
      });
      // A provider error stays in the server log (it can carry account details); our own errors are safe to show in the inspector.
      if (isApiError(err))
        console.error(`[playground] ${model.label} composer failed:`, err);
      fail(
        q,
        t0,
        isApiError(err)
          ? visitorError(err, model.label)
          : "The model couldn't build this UI. Try again, or ask in other words.",
        isApiError(err) ? undefined : message,
      );
    }
  }
  pipeline(q, t0, "done");
}

/* ───────────────────────── failures ───────────────────────── */

const isApiError = (err: unknown) =>
  typeof (err as { status?: unknown })?.status === "number" ||
  err instanceof OpenAI.APIError;

/** What a visitor reads when the model call fails. The raw error stays on the server. */
function visitorError(err: unknown, label: string) {
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403 || status === 404)
    return `${label} isn't available here right now. Try another model.`;
  if (status === 429)
    return `${label} is busy right now. Wait a moment and try again, or pick another model.`;
  return `${label} didn't answer. Try again, or pick another model.`;
}

/**
 * Ends the run as failed: the chat shows `message` with a Retry button and the
 * inspector logs `detail` (or the message). Both are written for visitors.
 */
function fail(q: EventQueue, t0: number, message: string, detail?: string) {
  pipeline(q, t0, "error", {
    message,
    detail: detail ?? message,
    failed: true,
  });
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
      const t0 = performance.now();
      run(input, abortSignal, q)
        .catch((err) => {
          if (abortSignal.aborted) return;
          const { label } = modelOf(
            (input.forwardedProps as { model?: string } | undefined)?.model,
          );
          console.error(`[playground] ${label} run failed:`, err);
          fail(
            q,
            t0,
            isApiError(err)
              ? visitorError(err, label)
              : `${label} didn't answer. Try again, or pick another model.`,
          );
        })
        .finally(() => q.close());
      return q;
    },
  });
}

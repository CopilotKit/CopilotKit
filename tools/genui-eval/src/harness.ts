import { randomUUID } from "node:crypto";
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/client";
import { AbstractAgent, EventType } from "@ag-ui/client";
import { splitA2UIMarkdown, extractFenceOperations } from "@copilotkit/core";
import { BuiltInAgent, GenerativeUIMiddleware } from "@copilotkit/runtime/v2";
import {
  GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATIVE_UI_CONTEXT_DESCRIPTION,
  GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
  GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
  applyDescriptionOverrides,
  buildGenerativeUIMarkdownGuidelines,
  buildGenerativeUIPrompt,
  defaultGenerativeUIPromptSpec,
  envelopeToManifest,
  generativeUIGuideFeatures,
  readCopilotKitUIEnvelope,
  renderGenerativeUISchema,
} from "@copilotkit/shared";
import type {
  GenerativeUIPromptSpec,
  GenerativeUIRejectedOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { wrapLanguageModel } from "ai";
import type { LanguageModel } from "ai";
import type { LanguageModelV3, LanguageModelV3Prompt } from "@ai-sdk/provider";
import { Observable } from "rxjs";
import type { EvalCase } from "./cases";
import type { ModelEntry, Transport } from "./config";
import {
  GenerativeUISurfaceManager,
  buildCatalogManifest,
  buildGenerativeUIEnvelope,
  buildMarkdownSurfaces,
  createGenerativeUIDispatcher,
  standardUI,
} from "./engine";
import type { GenerativeUI } from "./engine";
import { isFakeModel } from "./models";

/** What one model reply produced. */
export interface SampleOutput {
  /** The text of the reply. */
  text: string;
  /** The arguments of each render_ui call (tool transport). */
  toolCalls: unknown[];
  /** The surfaces as the client receives them. */
  surfaces: GenerativeUISurfaceContent[];
  /** Operations the runtime rejected (tool transport). */
  rejected: GenerativeUIRejectedOperation[];
  /** Fence lines or tool arguments that are not valid JSON. */
  parseErrors: string[];
  /** A run error, when the run failed. */
  error?: string;
  /** Prompt tokens of the model call (the model's own count when it gives one). */
  promptTokens: number;
  outputTokens: number;
  /** The system prompt the model saw. */
  systemPrompt: string;
}

/** The parts of the catalog that one run uses, with the description overrides. */
export function catalogFor(
  spec: GenerativeUIPromptSpec,
  ui: GenerativeUI = standardUI,
) {
  const base = buildCatalogManifest(ui);
  const { manifest, unknown } = applyDescriptionOverrides(
    base,
    spec.descriptions,
  );
  return { ui, manifest, unknownDescriptions: unknown };
}

/** The text of a model prompt, for the record and the token estimate. */
function promptToText(prompt: LanguageModelV3Prompt) {
  return prompt
    .map((message) =>
      typeof message.content === "string"
        ? `${message.role}: ${message.content}`
        : `${message.role}: ${message.content.map((p) => ("text" in p ? p.text : "")).join("")}`,
    )
    .join("\n\n");
}

/**
 * Wraps the model so the harness sees the exact prompt and the token
 * counts of the call, whatever the agent does around it.
 */
function recordingModel(
  model: LanguageModel,
  record: { system: string; input: number; output: number },
) {
  return wrapLanguageModel({
    model: model as LanguageModelV3,
    middleware: {
      specificationVersion: "v3",
      transformParams: async ({ params }) => {
        record.system = params.prompt
          .filter((m) => m.role === "system")
          .map((m) => (typeof m.content === "string" ? m.content : ""))
          .join("\n");
        if (!record.input)
          record.input = Math.ceil(promptToText(params.prompt).length / 4);
        return params;
      },
      wrapStream: async ({ doStream }) => {
        const result = await doStream();
        const transform = new TransformStream({
          transform(chunk, controller) {
            if (chunk.type === "finish") {
              record.input = chunk.usage.inputTokens.total ?? record.input;
              record.output = chunk.usage.outputTokens.total ?? record.output;
            }
            controller.enqueue(chunk);
          },
        });
        return { ...result, stream: result.stream.pipeThrough(transform) };
      },
    },
  });
}

/**
 * The agent the middleware calls. With a spec, it swaps the guide that the
 * middleware put in the context for the guide of the spec (same manifest,
 * other wording), then runs the built-in agent.
 */
class SpecAgent extends AbstractAgent {
  constructor(
    private readonly inner: AbstractAgent,
    private readonly spec: GenerativeUIPromptSpec | undefined,
  ) {
    super();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    if (!this.spec) return this.inner.run(input);
    const envelope = readCopilotKitUIEnvelope(input.forwardedProps);
    if (!envelope) return this.inner.run(input);
    const prompt = buildGenerativeUIPrompt(
      envelopeToManifest(envelope),
      this.spec,
    );
    const context = input.context.map((entry) =>
      entry.description === GENERATIVE_UI_CONTEXT_DESCRIPTION
        ? { ...entry, value: prompt }
        : entry,
    );
    return this.inner.run({ ...input, context });
  }
}

/** Applies the JSON Patch ops the middleware sends in ACTIVITY_DELTA. */
export function applyPatch(
  target: Record<string, unknown>,
  ops: Array<{ op: string; path: string; value?: unknown }>,
) {
  for (const { op, path, value } of ops) {
    const keys = path
      .split("/")
      .slice(1)
      .map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"));
    const last = keys.pop();
    if (last === undefined) continue;
    let node: any = target;
    for (const key of keys) node = node[key];
    if (Array.isArray(node) && last === "-") node.push(value);
    else if (op === "remove") {
      if (Array.isArray(node)) node.splice(Number(last), 1);
      else delete node[last];
    } else node[Array.isArray(node) ? Number(last) : last] = value;
  }
  return target;
}

/** The lines of each fence that are not valid JSON. */
function fenceParseErrors(text: string) {
  const errors: string[] = [];
  for (const segment of splitA2UIMarkdown(text)) {
    if (segment.type !== "a2ui") continue;
    const parsed = extractFenceOperations(segment.text);
    for (const line of parsed.invalidLines) {
      errors.push(`invalid fence line: ${line.slice(0, 160)}`);
    }
    // In a finished reply, an operation that is still open never closes.
    if (parsed.partialObject?.trim()) {
      errors.push(
        `invalid fence line: ${parsed.partialObject.trim().slice(0, 160)}`,
      );
    }
  }
  return errors;
}

/** The input of one run, built the way the client builds it. */
function buildInput(
  c: EvalCase,
  transport: Transport,
  spec: GenerativeUIPromptSpec,
  catalog: ReturnType<typeof catalogFor>,
  marker: string,
): RunAgentInput {
  const { ui, manifest } = catalog;
  const manager = new GenerativeUISurfaceManager(ui);
  const dispatcher = createGenerativeUIDispatcher({
    getDeclared: () => ui.functions,
  });
  const instructions =
    transport === "markdown"
      ? buildGenerativeUIMarkdownGuidelines(
          generativeUIGuideFeatures(manifest),
          spec,
        )
      : undefined;
  const envelope = buildGenerativeUIEnvelope(
    { ui, manager, dispatcher },
    undefined,
    {
      transport,
      includeCatalog: true,
      contextSent: transport === "markdown",
      instructions,
    },
  );
  // The descriptions of the spec reach the runtime through the catalog.
  const inline = envelope["v1.0"].inlineCatalogs?.[0];
  if (inline) inline.components = manifest.components;
  const context =
    transport === "markdown"
      ? [
          {
            description: GENERATIVE_UI_MARKDOWN_GUIDELINES_DESCRIPTION,
            value: instructions ?? "",
          },
          {
            description: GENERATIVE_UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
            value: renderGenerativeUISchema(manifest, spec.schema.markdown),
          },
        ]
      : [];
  const messages: Message[] = [
    ...(c.history ?? []).map(
      (turn) =>
        ({
          id: randomUUID(),
          role: turn.role,
          content: turn.content,
        }) as Message,
    ),
    { id: randomUUID(), role: "user", content: `${c.message}${marker}` },
  ];
  return {
    threadId: `eval-${c.id}`,
    runId: randomUUID(),
    messages,
    tools: [],
    context,
    state: {},
    forwardedProps: { copilotkit: { ui: envelope } },
  };
}

/** Collects the events of a run into the reply, the tool calls and the surfaces. */
function collect(events: Observable<BaseEvent>) {
  return new Promise<{
    text: string;
    toolArgs: string[];
    surfaces: Map<string, GenerativeUISurfaceContent>;
    error?: string;
  }>((resolve) => {
    let text = "";
    const args = new Map<string, string>();
    const surfaces = new Map<string, GenerativeUISurfaceContent>();
    let error: string | undefined;
    events.subscribe({
      next: (event: any) => {
        switch (event.type) {
          case EventType.TEXT_MESSAGE_CONTENT:
            text += event.delta ?? "";
            break;
          case EventType.TOOL_CALL_START:
            args.set(event.toolCallId, "");
            break;
          case EventType.TOOL_CALL_ARGS:
            args.set(
              event.toolCallId,
              (args.get(event.toolCallId) ?? "") + (event.delta ?? ""),
            );
            break;
          case EventType.ACTIVITY_SNAPSHOT:
            if (event.activityType === GENERATIVE_UI_ACTIVITY_TYPE) {
              surfaces.set(event.messageId, structuredClone(event.content));
            }
            break;
          case EventType.ACTIVITY_DELTA: {
            const content = surfaces.get(event.messageId);
            if (content)
              applyPatch(
                content as unknown as Record<string, unknown>,
                event.patch,
              );
            break;
          }
          case EventType.RUN_ERROR:
            error = event.message ?? "run error";
            break;
        }
      },
      error: (e: unknown) =>
        resolve({
          text,
          toolArgs: [...args.values()],
          surfaces,
          error: String((e as Error)?.message ?? e),
        }),
      complete: () =>
        resolve({ text, toolArgs: [...args.values()], surfaces, error }),
    });
  });
}

/**
 * Runs one case on one model and transport, through the code that ships:
 * the client's envelope and context entries, the runtime's
 * GenerativeUIMiddleware (tool transport), and the built-in agent. The
 * surfaces come out as the client receives them.
 */
export async function runSample(input: {
  case: EvalCase;
  transport: Transport;
  entry: Pick<ModelEntry, "model" | "params">;
  model: LanguageModel;
  spec?: GenerativeUIPromptSpec;
}): Promise<SampleOutput> {
  const spec = input.spec ?? defaultGenerativeUIPromptSpec();
  const catalog = catalogFor(spec);
  // Only a fake needs to know the case, to pick its scripted reply.
  const marker = isFakeModel(input.entry.model)
    ? ` [case:${input.case.id}] [transport:${input.transport}]`
    : "";
  const record = { system: "", input: 0, output: 0 };
  const agent = new BuiltInAgent({
    model: recordingModel(input.model, record),
    maxSteps: 1,
    temperature: input.entry.params?.temperature,
    maxOutputTokens: input.entry.params?.maxOutputTokens,
  });
  const runInput = buildInput(
    input.case,
    input.transport,
    spec,
    catalog,
    marker,
  );
  const events = new GenerativeUIMiddleware().run(
    runInput,
    new SpecAgent(agent, input.spec),
  );
  const collected = await collect(events);

  const parseErrors: string[] = [];
  const toolCalls: unknown[] = [];
  for (const raw of collected.toolArgs) {
    try {
      toolCalls.push(JSON.parse(raw));
    } catch {
      parseErrors.push(`invalid render_ui arguments: ${raw.slice(0, 160)}`);
    }
  }
  let surfaces: GenerativeUISurfaceContent[];
  if (input.transport === "markdown") {
    parseErrors.push(...fenceParseErrors(collected.text));
    const message = {
      id: "reply",
      role: "assistant",
      content: collected.text,
    } as Message;
    surfaces = buildMarkdownSurfaces([message], {
      ui: catalog.ui,
      functions: {},
      running: false,
    }).surfaces;
  } else {
    surfaces = [...collected.surfaces.values()];
  }
  return {
    text: collected.text,
    toolCalls,
    surfaces,
    rejected: surfaces.flatMap((s) => s.rejected ?? []),
    parseErrors,
    error: collected.error,
    promptTokens: record.input,
    outputTokens: record.output,
    systemPrompt: record.system,
  };
}

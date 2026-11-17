// The agents of the two .NET integrations, ms-agent-dotnet and
// ms-agent-harness-dotnet. Each runs a Microsoft Agent Framework server at
// AGENT_URL_<SLUG> with AG-UI endpoints for its demos. The two servers have
// the same endpoints, except `/a2ui-recovery`, which only ms-agent-dotnet has
// and serves. Some agents here change a run's request or its events, to do
// what the server does not do itself. Server only.
import { EventType, HttpAgent } from "@ag-ui/client";
import type {
  AbstractAgent,
  Event as AgUiEvent,
  BaseEvent,
  ContentPart,
  Context,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
import { concat, concatMap, defer, map } from "rxjs";
import { agentUrl, httpAgent } from "@/lib/agents";
import type { RuntimeConfig, RuntimeOptions } from "@/lib/agents";
import { hasDemo } from "@/lib/registry";
import { createTranscriptionService } from "@/lib/transcription-service";

// A JSON object or array: a value whose fields can be read.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// The value that `text` holds as JSON, or undefined when it is not JSON.
function parseJson(text: string) {
  try {
    const value: unknown = JSON.parse(text);
    return { value };
  } catch {
    return undefined;
  }
}

// The text of a message: the string, or its text parts joined.
function textOf(content: string | ContentPart[] | undefined) {
  if (content === undefined || typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

// The tool call id of a tool call event, or undefined for other events.
function toolCallIdOf(event: BaseEvent) {
  return typeof event.toolCallId === "string" ? event.toolCallId : undefined;
}

// `message` with `rewrite` applied to each tool call id in it.
function withToolCallIds(message: Message, rewrite: (id: string) => string) {
  switch (message.role) {
    case "tool":
      return { ...message, toolCallId: rewrite(message.toolCallId) };
    case "assistant": {
      const toolCalls = message.toolCalls?.map((call) => ({
        ...call,
        id: rewrite(call.id),
      }));
      return toolCalls === undefined ? message : { ...message, toolCalls };
    }
    default:
      return message;
  }
}

/**
 * Tool call ids tagged with the run that made them: `<id>__<tag>_run_<runId>`.
 *
 * aimock gives a tool call the same id in every run. A tagged id is new in
 * each run, so the browser sees each run's call as a new call. The tags come
 * off again before a request goes to the server, so the server and the aimock
 * fixtures, which key on the ids they made, still match.
 */
function runTags(tag: string) {
  const suffix = new RegExp(`__${tag}_run_[0-9a-f-]+$`, "i");
  const untag = (id: string) => id.replace(suffix, "");

  // Tags the calls of `toolName` in the events of one run. The event that
  // starts a call sets its tagged id, and the call's later events follow it.
  function tagger(runId: string, toolName: string) {
    const taggedIds = new Map<string, string>();
    return (event: BaseEvent) => {
      const toolCallId = toolCallIdOf(event);
      if (!toolCallId) return event;
      const id = untag(toolCallId);
      const isStart =
        event.type === EventType.TOOL_CALL_START ||
        event.type === EventType.TOOL_CALL_CHUNK;
      if (isStart && event.toolCallName === toolName) {
        taggedIds.set(id, `${id}__${tag}_run_${runId}`);
      }
      const taggedId = taggedIds.get(id);
      return taggedId === undefined
        ? event
        : { ...event, toolCallId: taggedId };
    };
  }

  return { untag, tagger };
}

const RUN_TAGS = runTags("ck");
const OPEN_GEN_UI_RUN_TAGS = runTags("ogui");

// Middleware: takes the run tags off the tool call ids of the request.
function withoutRunTags(input: RunAgentInput, next: AbstractAgent) {
  const messages = input.messages.map((message) =>
    withToolCallIds(message, RUN_TAGS.untag),
  );
  return next.run({ ...input, messages });
}

/**
 * An agent of the server's endpoint at `path`. It takes run tags off the tool
 * call ids of each request, so a thread with tagged ids still matches the
 * server's ids.
 */
function dotnetAgent(slug: string, path = "/") {
  return httpAgent(slug, path).use(withoutRunTags);
}

// The decision in a tool result: JSON with `approved`, `accepted` or
// `cancelled`, or a text that says the request was cancelled.
function decisionOf(content: string | ContentPart[]) {
  const text = textOf(content);
  if (!text) return undefined;
  const json = parseJson(text);
  if (json === undefined) {
    const lower = text.toLowerCase();
    const saysCancelled =
      lower.includes("cancelled") || lower.includes("canceled");
    const saysNotBooked = ["not scheduled", "not booked", "no time"].some(
      (phrase) => lower.includes(phrase),
    );
    return saysCancelled && saysNotBooked ? "cancelled" : undefined;
  }
  const result = json.value;
  if (!isRecord(result)) return undefined;
  if (result.approved === true || result.accepted === true) return "approved";
  if (result.approved === false || result.accepted === false) {
    return "rejected";
  }
  if (result.cancelled === true || result.canceled === true) return "cancelled";
  return undefined;
}

// `message` without its tool calls: nothing for a tool result, and an
// assistant message without its tool calls, or nothing when it has no text.
function withoutToolCalls(message: Message) {
  if (message.role === "tool") return [];
  if (message.role !== "assistant" || message.toolCalls === undefined) {
    return [message];
  }
  const textOnly = { ...message, toolCalls: undefined };
  return textOf(textOnly.content)?.trim() ? [textOnly] : [];
}

// When the newest message is the user's, the user has moved on, so the tool
// calls before it go, with their results.
function withoutStaleToolCalls(messages: Message[]) {
  const latest = messages.at(-1);
  if (latest?.role !== "user") return messages;
  const earlier = messages.slice(0, -1).flatMap(withoutToolCalls);
  return [...earlier, latest];
}

// The messages that a replay-safe agent sends. The run tags come off. A tool
// result that records a decision adds it to its call's id, for example
// `<id>__approved`, so a fixture can answer each decision. When the user has
// written since, the earlier tool calls go.
function replaySafeMessages(messages: Message[]) {
  const untagged = messages.map((message) =>
    withToolCallIds(message, RUN_TAGS.untag),
  );
  const decisions = new Map<string, string>();
  for (const message of untagged) {
    if (message.role !== "tool" || !message.toolCallId) continue;
    const decision = decisionOf(message.content);
    if (decision !== undefined) decisions.set(message.toolCallId, decision);
  }
  const decided = untagged.map((message) =>
    withToolCallIds(message, (id) => {
      const decision = decisions.get(id);
      return decision === undefined ? id : `${id}__${decision}`;
    }),
  );
  return withoutStaleToolCalls(decided);
}

/**
 * Middleware for the human-in-the-loop demos, where the browser answers
 * `toolName` calls. Their calls get run-tagged ids (see runTags), and the
 * request carries replaySafeMessages.
 */
function replaySafe(toolName: string) {
  return (input: RunAgentInput, next: AbstractAgent) => {
    const tagRun = RUN_TAGS.tagger(input.runId, toolName);
    const messages = replaySafeMessages(input.messages);
    return next.run({ ...input, messages }).pipe(map(tagRun));
  };
}

// The characters that a JSON string escape stands for, by the character after
// the backslash. A `\u` escape is decoded on its own.
const JSON_ESCAPES: Partial<Record<string, string>> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  '"': '"',
  "\\": "\\",
  "/": "/",
};

/**
 * The `document` string in the `write_document` arguments received so far.
 * The arguments stream as raw JSON, so before the end they look like
 * `{"document":"Autumn lea` and do not parse. This decodes the string up to
 * where the arguments end. An escape that is cut off waits for the next delta.
 */
function streamedDocument(args: string) {
  const json = parseJson(args);
  if (json !== undefined && isRecord(json.value)) {
    const document = json.value.document;
    if (typeof document === "string") return document;
  }

  const key = /"document"\s*:\s*"/.exec(args);
  if (key === null) return undefined;
  let document = "";
  for (let index = key.index + key[0].length; index < args.length; index++) {
    const char = args[index];
    // The closing quote: the string is complete.
    if (char === '"') break;
    if (char !== "\\") {
      document += char;
      continue;
    }
    const escaped = args[index + 1];
    if (escaped === undefined) break;
    if (escaped === "u") {
      const hex = args.slice(index + 2, index + 6);
      if (hex.length < 4) break;
      document += String.fromCharCode(parseInt(hex, 16));
      index += 5;
      continue;
    }
    document += JSON_ESCAPES[escaped] ?? escaped;
    index += 1;
  }
  return document;
}

// The steps in `set_steps` arguments, once the arguments are whole JSON.
function stepsIn(args: string) {
  const json = parseJson(args);
  const steps =
    json !== undefined && isRecord(json.value) ? json.value.steps : undefined;
  return Array.isArray(steps) ? { steps } : undefined;
}

// The document in `write_document` arguments, as it streams.
function documentIn(args: string) {
  const document = streamedDocument(args);
  return document === undefined ? undefined : { document };
}

/**
 * Middleware that streams the arguments of `toolName` calls into the agent's
 * state. On each argument delta, `readState` reads the state from the
 * arguments received so far, and a changed state goes out as a
 * STATE_SNAPSHOT. The tool calls themselves stay out of the chat. The server's
 * own STATE_SNAPSHOT at the end of the run passes through.
 */
function argsIntoState(
  toolName: string,
  readState: (args: string) => Record<string, unknown> | undefined,
) {
  return (input: RunAgentInput, next: AbstractAgent) => {
    // The arguments of each call so far, and the state last sent for it.
    const calls = new Map<string, { args: string; sentState?: string }>();
    return next.run(input).pipe(
      concatMap((event) => {
        const toolCallId = toolCallIdOf(event);
        if (!toolCallId) return [event];
        const startsCall =
          event.type === EventType.TOOL_CALL_START &&
          event.toolCallName === toolName;
        if (startsCall) {
          calls.set(toolCallId, { args: "" });
          return [];
        }
        const call = calls.get(toolCallId);
        if (call === undefined) return [event];
        switch (event.type) {
          case EventType.TOOL_CALL_ARGS: {
            call.args += typeof event.delta === "string" ? event.delta : "";
            const state = readState(call.args);
            const serialized = JSON.stringify(state);
            const isUnchanged = serialized === call.sentState;
            if (state === undefined || isUnchanged) return [];
            call.sentState = serialized;
            return [{ type: EventType.STATE_SNAPSHOT, snapshot: state }];
          }
          case EventType.TOOL_CALL_END:
            return [];
          case EventType.TOOL_CALL_RESULT:
            calls.delete(toolCallId);
            return [];
          default:
            return [event];
        }
      }),
    );
  };
}

// The text of the page's context entries (useAgentContext), or undefined when
// there are none.
function appContextText(context: Context[]) {
  const entries = context.filter((entry) => entry.description && entry.value);
  if (entries.length === 0) return undefined;
  const lines = entries.flatMap((entry) => [
    "",
    entry.description,
    entry.value,
  ]);
  return ["## Context from the application", ...lines].join("\n");
}

// Middleware for the readonly-state-agent-context demo: the page's context
// entries go to the agent as a system message at the start of the request.
function withAppContext(input: RunAgentInput, next: AbstractAgent) {
  const content = appContextText(input.context);
  if (content === undefined) return next.run(input);
  return next.run({
    ...input,
    messages: [
      { id: `${input.runId}-app-context`, role: "system", content },
      ...input.messages,
    ],
  });
}

// The system prompt of the shared-state-read-write demo, with the user's
// preferences from the agent's state.
function preferencesPrompt(state: unknown) {
  const preferences: Record<string, unknown> =
    isRecord(state) && isRecord(state.preferences) ? state.preferences : {};
  const name = typeof preferences.name === "string" ? preferences.name : "";
  const tone =
    typeof preferences.tone === "string" ? preferences.tone : "casual";
  const language =
    typeof preferences.language === "string" ? preferences.language : "English";
  const interests = Array.isArray(preferences.interests)
    ? preferences.interests.filter((interest) => typeof interest === "string")
    : [];

  return [
    "You are a helpful, concise assistant. The user's preferences are supplied via shared state and added as a system message at the start of every turn - always respect them. When the user asks you to remember something, or you observe something worth surfacing in the UI's notes panel, call `set_notes` with the FULL updated list of short notes (existing notes + new). Keep each note short.",
    "",
    "[shared-state-read-write] preferences:",
    "{",
    `  "name": ${JSON.stringify(name)},`,
    `  "tone": ${JSON.stringify(tone)},`,
    `  "language": ${JSON.stringify(language)},`,
    `  "interests": ${JSON.stringify(interests)}`,
    "}",
    "Tailor every response to these preferences. Address the user by name when appropriate.",
  ].join("\n");
}

// Middleware for the shared-state-read-write demo: the preferences in the
// agent's state go to the agent as a system message at the start of each
// request.
function withPreferences(input: RunAgentInput, next: AbstractAgent) {
  return next.run({
    ...input,
    messages: [
      {
        id: `${input.runId}-shared-state`,
        role: "system",
        content: preferencesPrompt(input.state),
      },
      ...input.messages,
    ],
  });
}

const REASONING_TEXT =
  "I am checking the request, choosing the relevant tool or answer path, and then summarizing the result.";

// One reasoning message, as the events that stream it.
function reasoningEvents(messageId: string) {
  const events: AgUiEvent[] = [
    { type: EventType.REASONING_START, messageId },
    { type: EventType.REASONING_MESSAGE_START, messageId, role: "reasoning" },
    {
      type: EventType.REASONING_MESSAGE_CONTENT,
      messageId,
      delta: REASONING_TEXT,
    },
    { type: EventType.REASONING_MESSAGE_END, messageId },
    { type: EventType.REASONING_END, messageId },
  ];
  return events;
}

/**
 * Middleware for the reasoning demos. The server's AG-UI host sends no
 * REASONING_* events, so this adds one reasoning message after RUN_STARTED,
 * for CopilotKit's reasoning slots to render. The host also rejects messages
 * with the reasoning role, so those stay out of the request.
 */
function withReasoning(input: RunAgentInput, next: AbstractAgent) {
  const messageId = `${input.runId}-reasoning`;
  let isSent = false;
  const reasoningOnce = () => {
    if (isSent) return [];
    isSent = true;
    return reasoningEvents(messageId);
  };
  const messages = input.messages.filter(
    (message) => message.role !== "reasoning",
  );
  const events = next.run({ ...input, messages });
  return concat(
    events.pipe(
      concatMap((event) =>
        event.type === EventType.RUN_STARTED
          ? [event, ...reasoningOnce()]
          : [event],
      ),
    ),
    // A run without RUN_STARTED gets the reasoning at its end.
    defer(reasoningOnce),
  );
}

/**
 * The agent of the multimodal demo, at the server's `/multimodal` endpoint,
 * which reads attachment content parts, such as images. It sends requests the
 * way HttpAgent does.
 */
export class DotnetMultimodalHttpAgent extends HttpAgent {}

/**
 * The agent of the Open Generative UI demos. Each `generateSandboxedUi` call
 * gets an id tagged with its run (see runTags), and the tags come off before
 * a request goes to the server.
 *
 * The runtime clones each agent for every request. This class holds no
 * fields of its own, so a clone keeps its behavior. A field added here needs
 * a `clone()` override that copies it.
 */
export class OpenGenUiHttpAgent extends HttpAgent {
  run(input: RunAgentInput) {
    const tagRun = OPEN_GEN_UI_RUN_TAGS.tagger(
      input.runId,
      "generateSandboxedUi",
    );
    const messages = input.messages.map((message) =>
      withToolCallIds(message, OPEN_GEN_UI_RUN_TAGS.untag),
    );
    return super.run({ ...input, messages }).pipe(map(tagRun));
  }
}

// The runtime config of a demo with one agent, under the agent id that the
// demo's page uses.
function demoConfig(
  agentId: string,
  agent: AbstractAgent,
  options?: RuntimeOptions,
) {
  const config: RuntimeConfig = { agents: { [agentId]: agent }, options };
  return config;
}

/**
 * The agents and runtime options of one demo of a .NET integration, or
 * undefined when the integration does not serve the demo (it is in neither
 * its manifest nor its extra demos).
 *
 * @param slug - `"ms-agent-dotnet"` or `"ms-agent-harness-dotnet"`. The agents
 *   call the server at `AGENT_URL_<SLUG>`.
 * @param demoId - The demo id, which is also the runtime key.
 * @throws UnconfiguredIntegrationError when `AGENT_URL_<SLUG>` is not set.
 *
 * @example
 * export default {
 *   createRuntimeConfig: (demoId) => dotnetRuntimeConfig("ms-agent-dotnet", demoId),
 * } satisfies IntegrationRuntime;
 */
export function dotnetRuntimeConfig(slug: string, demoId: string) {
  if (!hasDemo(slug, demoId)) return undefined;
  switch (demoId) {
    case "a2ui-fixed-schema":
      return demoConfig(demoId, httpAgent(slug, "/a2ui-fixed-schema"));
    case "a2ui-recovery":
      return demoConfig(demoId, httpAgent(slug, "/a2ui-recovery"));
    case "agent-config":
      return demoConfig("agent-config-demo", httpAgent(slug, "/agent-config"));
    case "agentic-chat":
      return demoConfig("agentic_chat", dotnetAgent(slug));
    case "auth":
      return demoConfig("auth-demo", httpAgent(slug));
    case "beautiful-chat":
      return demoConfig(demoId, httpAgent(slug, "/beautiful-chat"));
    case "chat-customization-css":
    case "chat-slots":
    case "frontend-tools-async":
    case "headless-simple":
    case "prebuilt-popup":
    case "prebuilt-sidebar":
    case "shared-state-read":
    case "threadid-frontend-tool-roundtrip":
      return demoConfig(demoId, dotnetAgent(slug));
    case "declarative-gen-ui":
      return demoConfig(demoId, httpAgent(slug, "/declarative-gen-ui"));
    case "declarative-hashbrown":
      return demoConfig(
        "declarative-hashbrown-demo",
        httpAgent(slug, "/byoc-hashbrown"),
      );
    case "declarative-json-render":
      return demoConfig(
        "byoc_json_render",
        httpAgent(slug, "/byoc-json-render"),
      );
    case "frontend-tools":
      return demoConfig("frontend_tools", dotnetAgent(slug));
    case "gen-ui-agent":
      return demoConfig(
        demoId,
        dotnetAgent(slug, "/gen-ui-agent").use(
          argsIntoState("set_steps", stepsIn),
        ),
      );
    case "gen-ui-interrupt":
    case "interrupt-headless":
      return demoConfig(
        demoId,
        dotnetAgent(slug, "/interrupt-adapted").use(
          replaySafe("schedule_meeting"),
        ),
      );
    case "gen-ui-tool-based":
      return demoConfig(demoId, dotnetAgent(slug, "/gen-ui-tool-based"));
    case "headless-complete":
      return demoConfig(demoId, httpAgent(slug, "/headless-complete"));
    case "hitl":
      return demoConfig(
        "human_in_the_loop",
        dotnetAgent(slug).use(replaySafe("generate_task_steps")),
      );
    case "hitl-in-app":
      return demoConfig(
        demoId,
        dotnetAgent(slug, "/hitl-in-app").use(
          replaySafe("request_user_approval"),
        ),
      );
    case "hitl-in-chat":
      return demoConfig(
        demoId,
        dotnetAgent(slug, "/hitl-in-chat").use(replaySafe("book_call")),
      );
    case "mcp-apps":
      return demoConfig(demoId, httpAgent(slug, "/mcp-apps/"));
    case "multimodal":
      return demoConfig(
        "multimodal-demo",
        new DotnetMultimodalHttpAgent({ url: `${agentUrl(slug)}/multimodal` }),
      );
    case "open-gen-ui":
      return demoConfig(
        demoId,
        new OpenGenUiHttpAgent({ url: `${agentUrl(slug)}/open-gen-ui` }),
      );
    case "open-gen-ui-advanced":
      return demoConfig(
        demoId,
        new OpenGenUiHttpAgent({
          url: `${agentUrl(slug)}/open-gen-ui-advanced`,
        }),
      );
    case "readonly-state-agent-context":
      return demoConfig(
        demoId,
        dotnetAgent(slug, "/readonly-state-agent-context").use(withAppContext),
      );
    case "reasoning-custom":
    case "reasoning-default":
      return demoConfig(
        demoId,
        dotnetAgent(slug, "/reasoning").use(withReasoning),
      );
    case "shared-state-read-write":
      return demoConfig(
        demoId,
        dotnetAgent(slug, "/shared-state-read-write").use(withPreferences),
      );
    case "shared-state-streaming":
      return demoConfig(
        demoId,
        dotnetAgent(slug, "/shared-state-streaming").use(
          argsIntoState("write_document", documentIn),
        ),
      );
    case "subagents":
      return demoConfig(demoId, dotnetAgent(slug, "/subagents"));
    case "tool-rendering":
    case "tool-rendering-custom-catchall":
    case "tool-rendering-default-catchall":
      return demoConfig(demoId, dotnetAgent(slug, "/tool-rendering"));
    case "tool-rendering-reasoning-chain":
      return demoConfig(
        demoId,
        dotnetAgent(slug, "/tool-rendering-reasoning-chain").use(withReasoning),
      );
    case "voice":
      // Transcription needs OPENAI_TRANSCRIPTION_API_KEY. Without it the
      // service is undefined, which turns transcription off.
      return demoConfig("voice-demo", httpAgent(slug, "/voice/"), {
        transcriptionService: createTranscriptionService(),
      });
    default:
      return undefined;
  }
}

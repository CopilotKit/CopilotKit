export const EVENT_SNIPPETS_STORAGE_KEY = "cpk:inspector:event-snippets";

export const SNIPPET_RECIPES = [
  "tool-call",
  "reasoning",
  "text",
  "activity",
  "raw",
] as const;

export type SnippetRecipe = (typeof SNIPPET_RECIPES)[number];

export type SnippetEvent = {
  type: string;
  [key: string]: unknown;
};

export type EventSnippet = {
  id: string;
  name: string;
  recipe: SnippetRecipe;
  events: SnippetEvent[];
  createdAt: string;
  updatedAt: string;
};

export type LastInject = {
  snippetId: string;
  agentId: string;
  runId: string;
  messageIds: string[];
};

export type AssistantSnippetMessage = {
  id: string;
  content?: string | null;
  toolCalls?: ReadonlyArray<{
    id: string;
    function: { name: string; arguments: string };
  }>;
};

export type ActivitySnippetMessage = {
  id: string;
  activityType: string;
  content: unknown;
};

export const ACTIVITY_STARTERS = [
  "a2ui-surface",
  "open-generative-ui",
] as const;

export function isSnippetRecipe(value: unknown): value is SnippetRecipe {
  return (
    typeof value === "string" &&
    SNIPPET_RECIPES.some((recipe) => recipe === value)
  );
}

export function createSnippetId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `cpk-snippet-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function autoSnippetName(recipe: SnippetRecipe, label: string): string {
  const time = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const base = label.trim() || recipeLabel(recipe);
  return `${base} - ${time}`;
}

export function recipeLabel(recipe: SnippetRecipe): string {
  switch (recipe) {
    case "tool-call":
      return "Tool call";
    case "reasoning":
      return "Reasoning";
    case "text":
      return "Assistant text";
    case "activity":
      return "Activity";
    case "raw":
      return "Raw events";
  }
}

export const GENERATE_SANDBOXED_UI_TOOL_NAME = "generateSandboxedUi";
export const OPEN_GENERATIVE_UI_ACTIVITY_TYPE = "open-generative-ui";

export function recipeIconName(recipe: SnippetRecipe): string {
  switch (recipe) {
    case "tool-call":
      return "Hammer";
    case "reasoning":
      return "Brain";
    case "text":
      return "MessageSquare";
    case "activity":
      return "LayoutDashboard";
    case "raw":
      return "Code";
  }
}

export function recipeIconWrapClass(recipe: SnippetRecipe): string {
  switch (recipe) {
    case "tool-call":
      return "bg-amber-100 text-amber-700";
    case "reasoning":
      return "bg-violet-100 text-violet-700";
    case "text":
      return "bg-sky-100 text-sky-700";
    case "activity":
      return "bg-emerald-100 text-emerald-700";
    case "raw":
      return "bg-gray-200 text-gray-700";
  }
}

export function groupEventSnippets(
  snippets: ReadonlyArray<EventSnippet>,
): Array<{
  recipe: SnippetRecipe;
  label: string;
  snippets: EventSnippet[];
}> {
  return SNIPPET_RECIPES.flatMap((recipe) => {
    const items = snippets.filter((snippet) => snippet.recipe === recipe);
    if (items.length === 0) {
      return [];
    }
    return [{ recipe, label: recipeLabel(recipe), snippets: items }];
  });
}

export function snippetJsonIsRunnable(raw: string): boolean {
  try {
    return parseSnippetEvents(raw).length > 0;
  } catch {
    return false;
  }
}

export function expandSnippetEventsForRun(
  events: ReadonlyArray<SnippetEvent>,
): SnippetEvent[] {
  const next = [...events];
  const hasOpenGenUi = next.some(
    (event) =>
      event.type === "ACTIVITY_SNAPSHOT" &&
      event.activityType === OPEN_GENERATIVE_UI_ACTIVITY_TYPE,
  );

  const toolCallIds: string[] = [];
  for (const event of next) {
    if (
      event.type === "TOOL_CALL_START" &&
      event.toolCallName === GENERATE_SANDBOXED_UI_TOOL_NAME &&
      typeof event.toolCallId === "string"
    ) {
      toolCallIds.push(event.toolCallId);
    }
  }
  if (toolCallIds.length === 0) {
    return next;
  }

  const argParts = new Map<string, string[]>();
  for (const event of next) {
    if (
      event.type === "TOOL_CALL_ARGS" &&
      typeof event.toolCallId === "string" &&
      typeof event.delta === "string"
    ) {
      const parts = argParts.get(event.toolCallId) ?? [];
      parts.push(event.delta);
      argParts.set(event.toolCallId, parts);
    }
  }

  const extras: SnippetEvent[] = [];
  for (const toolCallId of toolCallIds) {
    let addedSnapshot = false;
    if (!hasOpenGenUi) {
      const snapshot = activitySnapshotFromSandboxedUiArgs(
        toolCallId,
        (argParts.get(toolCallId) ?? []).join(""),
      );
      if (snapshot) {
        extras.push(snapshot);
        addedSnapshot = true;
      }
    }
    if (!hasOpenGenUi && !addedSnapshot) {
      continue;
    }
    const hasResult = next.some(
      (event) =>
        event.type === "TOOL_CALL_RESULT" && event.toolCallId === toolCallId,
    );
    if (!hasResult) {
      extras.push({
        type: "TOOL_CALL_RESULT",
        toolCallId,
        messageId: `${toolCallId}-result`,
        role: "tool",
        content: "UI generated",
      });
    }
  }
  if (extras.length === 0) {
    return next;
  }

  const finishIndex = next.findIndex((event) => event.type === "RUN_FINISHED");
  if (finishIndex === -1) {
    return [...next, ...extras];
  }
  return [...next.slice(0, finishIndex), ...extras, ...next.slice(finishIndex)];
}

function activitySnapshotFromSandboxedUiArgs(
  toolCallId: string,
  rawArgs: string,
): SnippetEvent | null {
  let args: { [key: string]: unknown };
  try {
    const parsed: unknown = JSON.parse(snippetArgsJson(rawArgs));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    args = parsed as { [key: string]: unknown };
  } catch {
    return null;
  }

  const html = sandboxedUiHtmlChunks(args.html);
  const css = typeof args.css === "string" ? args.css : undefined;
  const jsFunctions =
    typeof args.jsFunctions === "string" ? args.jsFunctions : undefined;
  const jsExpressions = Array.isArray(args.jsExpressions)
    ? args.jsExpressions.filter(
        (item): item is string => typeof item === "string",
      )
    : undefined;
  if (
    html.length === 0 &&
    css === undefined &&
    jsFunctions === undefined &&
    (jsExpressions === undefined || jsExpressions.length === 0)
  ) {
    return null;
  }

  return {
    type: "ACTIVITY_SNAPSHOT",
    messageId: `${toolCallId}-activity`,
    activityType: OPEN_GENERATIVE_UI_ACTIVITY_TYPE,
    content: {
      initialHeight:
        typeof args.initialHeight === "number" ? args.initialHeight : undefined,
      generating: false,
      css,
      cssComplete: true,
      html,
      htmlComplete: true,
      jsFunctions,
      jsFunctionsComplete: true,
      jsExpressions,
      jsExpressionsComplete: true,
    },
    replace: true,
  };
}

function sandboxedUiHtmlChunks(html: unknown): string[] {
  if (typeof html === "string" && html.length > 0) {
    return [html];
  }
  if (Array.isArray(html)) {
    return html.filter((item): item is string => typeof item === "string");
  }
  return [];
}

export function snippetContainsToolCall(
  events: ReadonlyArray<SnippetEvent>,
): boolean {
  return events.some(
    (event) =>
      typeof event.type === "string" && event.type.startsWith("TOOL_CALL"),
  );
}

export function ensureRunEnvelope(
  events: ReadonlyArray<SnippetEvent>,
  ids: { threadId: string; runId: string },
): SnippetEvent[] {
  const next = [...events];
  const hasStart = next.some((event) => event.type === "RUN_STARTED");
  const hasFinish = next.some((event) => event.type === "RUN_FINISHED");
  if (!hasStart) {
    next.unshift({
      type: "RUN_STARTED",
      threadId: ids.threadId,
      runId: ids.runId,
    });
  }
  if (!hasFinish) {
    next.push({
      type: "RUN_FINISHED",
      threadId: ids.threadId,
      runId: ids.runId,
    });
  }
  return next;
}

export function snippetArgsJson(value: unknown): string {
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  if (typeof value !== "string") {
    return "{}";
  }
  const trimmed = value.trim() || "{}";
  try {
    return JSON.stringify(JSON.parse(trimmed));
  } catch {
    const recovered = firstJsonValue(trimmed);
    if (recovered !== undefined) {
      return JSON.stringify(recovered);
    }
    throw new Error("Tool args JSON is invalid.");
  }
}

// ponytail: single depth scan instead of parse-every-prefix. Recovers the first
// complete object from text with trailing junk, and bails at once on truncated
// args (a streaming tool call) rather than walking the whole string.
function firstJsonValue(raw: string): unknown {
  const start = raw.indexOf("{");
  if (start === -1) {
    return undefined;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, index + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

export function compileToolCallRecipe(input: {
  toolName: string;
  argsJson: string | Record<string, unknown>;
  threadId: string;
  runId: string;
  parentMessageId?: string;
  toolCallId?: string;
}): SnippetEvent[] {
  const toolName = input.toolName.trim();
  if (!toolName) {
    throw new Error("Tool name is required.");
  }
  const argsJson = snippetArgsJson(input.argsJson);
  parseObjectJson(argsJson, "Tool args");
  const parentMessageId = input.parentMessageId ?? createSnippetId();
  const toolCallId = input.toolCallId ?? createSnippetId();
  return ensureRunEnvelope(
    [
      {
        type: "TOOL_CALL_START",
        toolCallId,
        toolCallName: toolName,
        parentMessageId,
      },
      {
        type: "TOOL_CALL_ARGS",
        toolCallId,
        delta: argsJson,
      },
      {
        type: "TOOL_CALL_END",
        toolCallId,
      },
    ],
    input,
  );
}

export function compileReasoningRecipe(input: {
  text: string;
  threadId: string;
  runId: string;
}): SnippetEvent[] {
  const text = input.text.trim();
  if (!text) {
    throw new Error("Reasoning text is required.");
  }
  const messageId = createSnippetId();
  return ensureRunEnvelope(
    [
      { type: "REASONING_START", messageId },
      { type: "REASONING_MESSAGE_START", messageId, role: "reasoning" },
      { type: "REASONING_MESSAGE_CONTENT", messageId, delta: text },
      { type: "REASONING_MESSAGE_END", messageId },
      { type: "REASONING_END", messageId },
    ],
    input,
  );
}

export function compileTextRecipe(input: {
  text: string;
  threadId: string;
  runId: string;
  messageId?: string;
}): SnippetEvent[] {
  const text = input.text.trim();
  if (!text) {
    throw new Error("Assistant text is required.");
  }
  const messageId = input.messageId ?? createSnippetId();
  return ensureRunEnvelope(
    [
      { type: "TEXT_MESSAGE_START", messageId, role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId, delta: text },
      { type: "TEXT_MESSAGE_END", messageId },
    ],
    input,
  );
}

export function compileActivityRecipe(input: {
  activityType: string;
  contentJson: string;
  threadId: string;
  runId: string;
  messageId?: string;
}): SnippetEvent[] {
  const activityType = input.activityType.trim();
  if (!activityType) {
    throw new Error("Activity type is required.");
  }
  const content = parseObjectJson(input.contentJson, "Activity content");
  const messageId = input.messageId ?? createSnippetId();
  return ensureRunEnvelope(
    [
      {
        type: "ACTIVITY_SNAPSHOT",
        messageId,
        activityType,
        content,
        replace: true,
      },
    ],
    input,
  );
}

export type ChatSnippetCapture =
  | {
      kind: "text";
      messageId: string;
      content: string;
    }
  | {
      kind: "reasoning";
      messageId: string;
      content: string;
    }
  | {
      kind: "tool-call";
      messageId: string;
      toolCallId: string;
      toolName: string;
      argsJson: string | Record<string, unknown>;
    }
  | {
      kind: "activity";
      messageId: string;
      activityType: string;
      content: unknown;
    };

export type RecipeDraft = {
  toolName: string;
  toolArgs: string;
  reasoningText: string;
  textContent: string;
  activityType: string;
  activityContent: string;
};

export function emptyRecipeDraft(): RecipeDraft {
  return {
    toolName: "",
    toolArgs: "{}",
    reasoningText: "",
    textContent: "",
    activityType: "a2ui-surface",
    activityContent: "{}",
  };
}

export function compileChatSnippet(
  input: ChatSnippetCapture & { threadId: string; runId: string },
): { recipe: SnippetRecipe; events: SnippetEvent[]; name: string } {
  switch (input.kind) {
    case "text":
      return {
        recipe: "text",
        events: compileTextRecipe({
          text: input.content,
          threadId: input.threadId,
          runId: input.runId,
          messageId: input.messageId,
        }),
        name: autoSnippetName("text", snippetLabelFromText(input.content)),
      };
    case "reasoning":
      return {
        recipe: "reasoning",
        events: compileReasoningRecipe({
          text: input.content,
          threadId: input.threadId,
          runId: input.runId,
        }),
        name: autoSnippetName("reasoning", snippetLabelFromText(input.content)),
      };
    case "tool-call":
      return {
        recipe: "tool-call",
        events: compileToolCallRecipe({
          toolName: input.toolName,
          argsJson: snippetArgsJson(input.argsJson),
          threadId: input.threadId,
          runId: input.runId,
          parentMessageId: input.messageId,
          toolCallId: input.toolCallId,
        }),
        name: autoSnippetName("tool-call", input.toolName),
      };
    case "activity":
      return {
        recipe: "activity",
        events: compileActivityRecipe({
          activityType: input.activityType,
          contentJson: JSON.stringify(input.content ?? {}),
          threadId: input.threadId,
          runId: input.runId,
          messageId: input.messageId,
        }),
        name: autoSnippetName("activity", input.activityType),
      };
  }
}

export function editorStateFromSnippet(snippet: EventSnippet): {
  recipe: SnippetRecipe;
  name: string;
  json: string;
  draft: RecipeDraft;
} {
  return {
    recipe: snippet.recipe,
    name: snippet.name,
    json: JSON.stringify(snippet.events, null, 2),
    draft: recipeDraftFromEvents(snippet.events),
  };
}

export function recipeDraftFromEvents(
  events: ReadonlyArray<SnippetEvent>,
): RecipeDraft {
  const draft = emptyRecipeDraft();
  const textParts: string[] = [];
  const reasoningParts: string[] = [];
  const argParts: string[] = [];

  for (const event of events) {
    if (event.type === "TEXT_MESSAGE_CONTENT") {
      const delta = readEventString(event, "delta");
      if (delta) {
        textParts.push(delta);
      }
    }
    if (event.type === "REASONING_MESSAGE_CONTENT") {
      const delta = readEventString(event, "delta");
      if (delta) {
        reasoningParts.push(delta);
      }
    }
    if (event.type === "TOOL_CALL_START") {
      const toolName = readEventString(event, "toolCallName");
      if (toolName) {
        draft.toolName = toolName;
      }
    }
    if (event.type === "TOOL_CALL_ARGS") {
      const delta = readEventString(event, "delta");
      if (delta) {
        argParts.push(delta);
      }
    }
    if (event.type === "ACTIVITY_SNAPSHOT") {
      const activityType = readEventString(event, "activityType");
      if (activityType) {
        draft.activityType = activityType;
      }
      draft.activityContent = prettyJson(event.content ?? {});
    }
  }

  draft.textContent = textParts.join("");
  draft.reasoningText = reasoningParts.join("");
  if (argParts.length > 0) {
    draft.toolArgs = prettyJson(argParts.join(""));
  }
  return draft;
}

export function compileFromActivityMessage(input: {
  message: ActivitySnippetMessage;
  threadId: string;
  runId: string;
}): { recipe: SnippetRecipe; events: SnippetEvent[]; name: string } {
  return compileChatSnippet({
    kind: "activity",
    messageId: input.message.id,
    activityType: input.message.activityType,
    content: input.message.content,
    threadId: input.threadId,
    runId: input.runId,
  });
}

export function parseSnippetEvents(raw: string): SnippetEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Snippet JSON is invalid.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Snippet JSON must be an array of events.");
  }
  const events: SnippetEvent[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Each event must be an object with a string type.");
    }
    const record = item as { type?: unknown };
    if (typeof record.type !== "string" || record.type.length === 0) {
      throw new Error("Each event must have a string type.");
    }
    events.push(item as SnippetEvent);
  }
  return events;
}

export function loadEventSnippets(
  storage: Pick<Storage, "getItem"> | null = defaultStorage(),
): EventSnippet[] {
  if (!storage) {
    return [];
  }
  try {
    const raw = storage.getItem(EVENT_SNIPPETS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((item) => {
      const snippet = parseStoredSnippet(item);
      return snippet ? [snippet] : [];
    });
  } catch {
    return [];
  }
}

export function saveEventSnippets(
  snippets: ReadonlyArray<EventSnippet>,
  storage: Pick<Storage, "setItem"> | null = defaultStorage(),
): void {
  if (!storage) {
    throw new Error("Snippet storage is not available.");
  }
  storage.setItem(EVENT_SNIPPETS_STORAGE_KEY, JSON.stringify(snippets));
}

export function upsertEventSnippet(
  snippet: EventSnippet,
  storage: Pick<Storage, "getItem" | "setItem"> | null = defaultStorage(),
): EventSnippet[] {
  const current = loadEventSnippets(storage);
  const index = current.findIndex((item) => item.id === snippet.id);
  const next =
    index === -1
      ? [...current, snippet]
      : current.map((item, itemIndex) =>
          itemIndex === index ? snippet : item,
        );
  saveEventSnippets(next, storage);
  return next;
}

export function deleteEventSnippet(
  id: string,
  storage: Pick<Storage, "getItem" | "setItem"> | null = defaultStorage(),
): EventSnippet[] {
  const next = loadEventSnippets(storage).filter((item) => item.id !== id);
  saveEventSnippets(next, storage);
  return next;
}

export function exportEventSnippetsJson(
  snippets: ReadonlyArray<EventSnippet>,
): string {
  return JSON.stringify(snippets, null, 2);
}

export function importEventSnippets(
  raw: string,
  storage: Pick<Storage, "getItem" | "setItem"> | null = defaultStorage(),
): EventSnippet[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Import JSON is invalid.");
  }
  const incoming = Array.isArray(parsed) ? parsed : [parsed];
  const imported: EventSnippet[] = [];
  for (const item of incoming) {
    const snippet = parseStoredSnippet(item);
    if (!snippet) {
      throw new Error("Import JSON is not a valid snippet list.");
    }
    imported.push({
      ...snippet,
      id: createSnippetId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  if (imported.length === 0) {
    throw new Error("Import JSON is not a valid snippet list.");
  }
  const next = [...loadEventSnippets(storage), ...imported];
  saveEventSnippets(next, storage);
  return next;
}

function snippetLabelFromText(text: string): string {
  const compact = text.trim().replace(/\s+/g, " ");
  if (compact.length <= 40) {
    return compact;
  }
  return `${compact.slice(0, 37)}...`;
}

function parseObjectJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} JSON is invalid.`);
  }
}

function readEventString(event: SnippetEvent, key: string): string | null {
  const value = event[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function prettyJson(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function parseStoredSnippet(value: unknown): EventSnippet | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as {
    id?: unknown;
    name?: unknown;
    recipe?: unknown;
    events?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
  };
  if (typeof record.id !== "string" || record.id.length === 0) {
    return null;
  }
  if (typeof record.name !== "string") {
    return null;
  }
  if (!isSnippetRecipe(record.recipe)) {
    return null;
  }
  if (!Array.isArray(record.events)) {
    return null;
  }
  const events: SnippetEvent[] = [];
  for (const event of record.events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      return null;
    }
    if (typeof (event as SnippetEvent).type !== "string") {
      return null;
    }
    events.push(event as SnippetEvent);
  }
  return {
    id: record.id,
    name: record.name,
    recipe: record.recipe,
    events,
    createdAt:
      typeof record.createdAt === "string"
        ? record.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof record.updatedAt === "string"
        ? record.updatedAt
        : new Date().toISOString(),
  };
}

function defaultStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

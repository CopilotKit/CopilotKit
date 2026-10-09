/**
 * Shared-state plumbing for the Strands showcase agent.
 *
 * Mirrors the Python sibling's `with_state_context` + `*_state_from_args` /
 * `*_state_from_result` hooks: the UI owns certain state slots (preferences,
 * notes, steps, sales todos, delegations) and the adapter emits
 * `StateSnapshotEvent`s the moment a tool fires so the corresponding panel
 * re-renders without waiting for the text response to stream.
 */

import type {
  ToolCallContext,
  ToolResultContext,
  StatePayload,
} from "@ag-ui/aws-strands";
import type { RunAgentInput } from "@ag-ui/core";
import { manageTodosImpl } from "../../shared-tools/todos";
import type { BoardTodo } from "../../shared-tools/todos";

/** Parse a tool's input (string JSON or already-parsed object). */
function parseToolInput(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return raw;
}

// ---- transient request context -------------------------------------------------

function formatPreferencesBlock(prefs: unknown): string | null {
  if (!prefs || typeof prefs !== "object") return null;
  const p = prefs as Record<string, unknown>;
  const lines: string[] = [];
  if (p.name) lines.push(`- Name: ${p.name}`);
  if (p.tone) lines.push(`- Preferred tone: ${p.tone}`);
  if (p.language) lines.push(`- Preferred language: ${p.language}`);
  const interests = p.interests;
  if (Array.isArray(interests) && interests.length > 0) {
    lines.push(`- Interests: ${interests.map((i) => String(i)).join(", ")}`);
  }
  if (lines.length === 0) return null;
  return (
    "The user has shared these preferences with you:\n" +
    lines.join("\n") +
    "\nTailor every response to these preferences. Address the user by name when appropriate."
  );
}

/** Keep application context transient; never rewrite persisted user messages. */
// @region[agent-config-context-builder]
export function withStateContext(inputData: RunAgentInput): RunAgentInput {
  const state =
    inputData.state && typeof inputData.state === "object"
      ? (inputData.state as Record<string, unknown>)
      : {};
  const context = [...inputData.context];
  const preferences = formatPreferencesBlock(state.preferences);
  if (preferences) {
    context.push({
      description: "Current user preferences",
      value: preferences,
    });
  }
  if ("todos" in state) {
    context.push({
      description: "Current sales pipeline",
      value: JSON.stringify(state.todos, null, 2),
    });
  }
  return { ...inputData, context };
}
// @endregion[agent-config-context-builder]

// ---- state-from-args hooks -----------------------------------------------

/** The Strands `appState` key `manage_sales_todos` keeps the pipeline under. */
export const SALES_TODOS_STATE_KEY = "todos";

/**
 * Normalize the list one `manage_sales_todos` call carries. A todo the model
 * sent without an id gets one derived from the call id, so the UI snapshot
 * built from the args and the copy the tool stores name each item the same way.
 */
export function salesTodosForCall(
  todos: Record<string, unknown>[],
  toolUseId: string | undefined,
): BoardTodo[] {
  if (!toolUseId) return manageTodosImpl(todos);
  return manageTodosImpl(
    todos.map((todo, index) =>
      todo.id ? todo : { ...todo, id: `${toolUseId}-${index}` },
    ),
  );
}

/** manage_sales_todos → { todos } */
export async function salesStateFromArgs(
  ctx: ToolCallContext,
): Promise<StatePayload | null> {
  const input = parseToolInput(ctx.toolInput);
  let todos: unknown;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    todos = (input as Record<string, unknown>).todos ?? input;
  } else if (Array.isArray(input)) {
    todos = input;
  } else {
    return null;
  }
  if (!Array.isArray(todos)) return null;
  return { todos: salesTodosForCall(todos as never[], ctx.toolUseId) };
}

/** set_notes → { notes } */
export async function notesStateFromArgs(
  ctx: ToolCallContext,
): Promise<StatePayload | null> {
  const input = parseToolInput(ctx.toolInput);
  let notes: unknown;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    notes = (input as Record<string, unknown>).notes;
  } else if (Array.isArray(input)) {
    notes = input;
  }
  if (!Array.isArray(notes)) return null;
  return { notes: notes.map((n) => String(n)) };
}

/** set_steps → { steps } (gen-ui-agent live progress card) */
export async function stepsStateFromArgs(
  ctx: ToolCallContext,
): Promise<StatePayload | null> {
  const input = parseToolInput(ctx.toolInput);
  let steps: unknown;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    steps = (input as Record<string, unknown>).steps;
  } else if (Array.isArray(input)) {
    steps = input;
  }
  if (!Array.isArray(steps)) return null;
  const cleaned = steps
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({
      id: String(s.id ?? ""),
      title: String(s.title ?? ""),
      status: String(s.status ?? "pending"),
    }));
  return { steps: cleaned };
}

/** write_document → { document } (shared-state-streaming live document).
 *
 *  Mirrors langgraph-python's StateStreamingMiddleware target: the full
 *  document string lands in `state.document`. Strands updates state from the
 *  complete tool args (not per-token), which the d5 probe tolerates — it only
 *  asserts the document grew substantively after settle, not mid-stream
 *  chunking. */
export async function documentStateFromArgs(
  ctx: ToolCallContext,
): Promise<StatePayload | null> {
  const input = parseToolInput(ctx.toolInput);
  let document: unknown;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    document = (input as Record<string, unknown>).document;
  } else if (typeof input === "string") {
    document = input;
  }
  if (typeof document !== "string" || document.length === 0) return null;
  return { document };
}

// ---- sub-agents (delegation log) -----------------------------------------

// @region[subagent-state-from-result]
/** Marker returned by a sub-agent tool body when its LLM call failed. */
export const SUBAGENT_FAILURE_MARKER = "__SUBAGENT_FAILED__:";

interface Delegation {
  id: string;
  sub_agent: string;
  task: string;
  status: "completed" | "failed";
  result: string;
}

// Per-thread scratchpad of delegations, seeded from inbound state so a
// multi-turn conversation appends rather than overwrites.
const delegationsByThread = new Map<string, Delegation[]>();

function seedDelegations(threadId: string, state: unknown): Delegation[] {
  const existing = delegationsByThread.get(threadId);
  if (existing) return existing;
  let seeded: Delegation[] = [];
  if (state && typeof state === "object") {
    const d = (state as Record<string, unknown>).delegations;
    if (Array.isArray(d)) {
      seeded = d.filter((x): x is Delegation => !!x && typeof x === "object");
    }
  }
  delegationsByThread.set(threadId, seeded);
  return seeded;
}

function readSubagentTask(raw: unknown): string {
  let input = raw;
  if (typeof raw === "string") {
    try {
      input = JSON.parse(raw);
    } catch {
      return "";
    }
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  return String((input as Record<string, unknown>).task ?? "");
}

function flattenResult(resultData: unknown): string {
  if (resultData == null) return "";
  if (typeof resultData === "string") return resultData;
  if (Array.isArray(resultData)) {
    const parts: string[] = [];
    for (const item of resultData) {
      if (item && typeof item === "object" && "text" in item) {
        const t = (item as { text?: unknown }).text;
        if (typeof t === "string") parts.push(t);
      } else if (typeof item === "string") {
        parts.push(item);
      }
    }
    if (parts.length) return parts.join("\n");
  }
  if (typeof resultData === "object" && "text" in resultData) {
    const t = (resultData as { text?: unknown }).text;
    if (typeof t === "string") return t;
  }
  return JSON.stringify(resultData);
}

/** Republish authoritative reads so a reconnect can rebuild an empty board. */
export function salesStateFromResult(
  ctx: Pick<ToolResultContext, "resultData">,
): StatePayload {
  const result = ctx.resultData;
  // Parsed native records may carry arbitrary metadata, including "text".
  // Only transport text blocks should pass through flattenResult.
  const nativeList =
    Array.isArray(result) &&
    result.every(
      (todo) =>
        todo &&
        typeof todo === "object" &&
        !Array.isArray(todo) &&
        ("title" in todo || !("text" in todo)),
    );
  const todos: unknown = nativeList
    ? result
    : JSON.parse(flattenResult(result));
  if (
    !Array.isArray(todos) ||
    todos.some(
      (todo) => !todo || typeof todo !== "object" || Array.isArray(todo),
    )
  ) {
    throw new Error("get_sales_todos returned an invalid todo list");
  }
  return { todos };
}

/**
 * Factory for a `stateFromResult` hook bound to a sub-agent name. On each
 * delegation it appends a Delegation entry to the per-thread scratchpad and
 * returns the full updated list so the adapter emits a `StateSnapshotEvent`.
 */
export function makeSubagentStateFromResult(subAgentName: string) {
  return async (ctx: ToolResultContext): Promise<StatePayload | null> => {
    const threadId = ctx.inputData.threadId || "default";
    const existing = seedDelegations(threadId, ctx.inputData.state);

    const task = readSubagentTask(ctx.toolInput);

    const resultText = flattenResult(ctx.resultData);
    let status: Delegation["status"];
    let displayResult: string;
    if (resultText.startsWith(SUBAGENT_FAILURE_MARKER)) {
      status = "failed";
      const failureClass =
        resultText.slice(SUBAGENT_FAILURE_MARKER.length).trim() || "Error";
      displayResult = `Sub-agent call failed (${failureClass}).`;
    } else {
      status = "completed";
      displayResult = resultText;
    }

    const entry: Delegation = {
      id: crypto.randomUUID(),
      sub_agent: subAgentName,
      task,
      status,
      result: displayResult,
    };
    const updated = [...existing, entry];
    delegationsByThread.set(threadId, updated);
    return { delegations: updated.map((d) => ({ ...d })) };
  };
}
// @endregion[subagent-state-from-result]

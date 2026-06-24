/**
 * Shared-state plumbing for the Strands showcase agent.
 *
 * Mirrors the Python sibling's `build_state_prompt` + `*_state_from_args` /
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
import { manageSalesTodosImpl } from "./lib/tool-impls";

/** Marker returned by a sub-agent tool body when its LLM call failed. */
export const SUBAGENT_FAILURE_MARKER = "__SUBAGENT_FAILED__:";

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

// ---- stateContextBuilder -------------------------------------------------

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

/**
 * Format the AG-UI `context` array into a prompt block.
 *
 * `RunAgentInput.context` is populated by the frontend's `useAgentContext`
 * (readonly-state-agent-context), by `openGenerativeUI.designSkill`, and by
 * sandbox-function descriptors (open-gen-ui / advanced). The Strands adapter
 * does NOT surface `context` to the model on its own, so without lifting it
 * here the agent never sees readonly context ("Who am I?") nor the
 * open-gen-ui design skill / "call generateSandboxedUi" guidance. Mirrors
 * langgraph's lift-context-into-prompt pattern; the Python sibling does the
 * same in `build_state_prompt`.
 */
function formatContextBlock(context: unknown): string | null {
  if (!Array.isArray(context) || context.length === 0) return null;
  const lines: string[] = [];
  for (const item of context) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    if (c.description == null || c.value == null) continue;
    lines.push(`- ${String(c.description)}: ${String(c.value)}`);
  }
  if (lines.length === 0) return null;
  return (
    "Context for this conversation (treat as authoritative — use it to answer questions about the user and follow any instructions it contains):\n" +
    lines.join("\n")
  );
}

/**
 * Inject UI-owned shared-state slots and AG-UI context into the outgoing
 * prompt. Degrades to the original prompt when no relevant slot is present.
 */
export function buildStatePrompt(
  inputData: RunAgentInput,
  prompt: string,
): string {
  const state = (inputData.state ?? {}) as Record<string, unknown>;

  const blocks: string[] = [];
  if (state && typeof state === "object") {
    const prefsBlock = formatPreferencesBlock(state.preferences);
    if (prefsBlock) blocks.push(prefsBlock);
    if ("todos" in state) {
      blocks.push(
        `Current sales pipeline:\n${JSON.stringify(state.todos, null, 2)}`,
      );
    }
  }
  const contextBlock = formatContextBlock(inputData.context);
  if (contextBlock) blocks.push(contextBlock);

  if (blocks.length === 0) return prompt;
  return `${blocks.join("\n\n")}\n\nUser request: ${prompt}`;
}

// ---- state-from-args hooks -----------------------------------------------

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
  return { todos: manageSalesTodosImpl(todos as never[]) };
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

/**
 * Factory for a `stateFromResult` hook bound to a sub-agent name. On each
 * delegation it appends a Delegation entry to the per-thread scratchpad and
 * returns the full updated list so the adapter emits a `StateSnapshotEvent`.
 */
export function makeSubagentStateFromResult(subAgentName: string) {
  return async (ctx: ToolResultContext): Promise<StatePayload | null> => {
    const threadId = ctx.inputData.threadId || "default";
    const existing = seedDelegations(threadId, ctx.inputData.state);

    const input = parseToolInput(ctx.toolInput);
    let task = "";
    if (input && typeof input === "object" && !Array.isArray(input)) {
      task = String((input as Record<string, unknown>).task ?? "");
    }

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

/**
 * System prompt + state-injection helpers for the Shared State (Read +
 * Write) demo. Mirrors `langgraph-python/src/agents/shared_state_read_write.py`.
 *
 * The UI owns a `preferences` object that it writes into agent state via
 * `agent.setState({ preferences })`. The AG-UI client forwards that into
 * the next `RunAgentInput.state.preferences`. Every turn we read those
 * preferences and prepend them to the Claude system prompt, so the UI's
 * writes visibly steer the agent.
 *
 * Conversely, the agent's `set_notes` tool writes a `notes: string[]`
 * slot back into shared state, which the agent_server emits as a
 * `STATE_SNAPSHOT` so the UI's `useAgent` hook re-renders the notes
 * sidebar in real time.
 */

export interface Preferences {
  name?: string;
  tone?: "formal" | "casual" | "playful";
  language?: string;
  interests?: string[];
}

export const SHARED_STATE_READ_WRITE_BASE_SYSTEM =
  "You are a helpful, concise assistant. " +
  "The user's preferences are supplied via shared state and will be " +
  "added to the system prompt at the start of every turn. Always " +
  "respect them. " +
  "When the user asks you to remember something, or when you observe " +
  "something worth surfacing in the UI, call `set_notes` with the " +
  "FULL updated list of short note strings (existing notes + new). " +
  "Each note should be under 120 characters.";

export const SET_NOTES_TOOL_SCHEMA = {
  name: "set_notes" as const,
  description:
    "Replace the notes array in shared state with the full updated list. " +
    "Use whenever the user asks you to 'remember' something, or when you " +
    "have an observation worth surfacing in the UI's notes panel. " +
    "Always pass the FULL notes list (existing + new), not a diff. " +
    "Keep each note short (< 120 chars).",
  input_schema: {
    type: "object" as const,
    properties: {
      notes: {
        type: "array",
        items: { type: "string" },
        description:
          "The complete updated notes array. Replaces the current notes.",
      },
    },
    required: ["notes"],
  },
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Coerce an arbitrary `unknown` (e.g. `input.state.preferences`) into a
 * sanitized `Preferences` object. We accept partial shapes — any field
 * may be missing — and silently drop fields that don't match the
 * expected types so a misbehaving frontend can't poison the prompt.
 */
export function coercePreferences(value: unknown): Preferences {
  if (!value || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const out: Preferences = {};
  if (typeof v.name === "string") out.name = v.name;
  if (v.tone === "formal" || v.tone === "casual" || v.tone === "playful") {
    out.tone = v.tone;
  }
  if (typeof v.language === "string") out.language = v.language;
  if (isStringArray(v.interests)) out.interests = v.interests;
  return out;
}

export function buildPreferencesPreamble(prefs: Preferences): string | null {
  const lines: string[] = [];
  if (prefs.name) lines.push(`- Name: ${prefs.name}`);
  if (prefs.tone) lines.push(`- Preferred tone: ${prefs.tone}`);
  if (prefs.language) lines.push(`- Preferred language: ${prefs.language}`);
  if (prefs.interests && prefs.interests.length > 0) {
    lines.push(`- Interests: ${prefs.interests.join(", ")}`);
  }
  if (lines.length === 0) return null;
  return [
    "The user has shared these preferences with you:",
    ...lines,
    "Tailor every response to these preferences. Address the user by name " +
      "when appropriate.",
  ].join("\n");
}

export function buildSharedStateReadWriteSystemPrompt(
  prefs: Preferences,
): string {
  const preamble = buildPreferencesPreamble(prefs);
  if (!preamble) return SHARED_STATE_READ_WRITE_BASE_SYSTEM;
  return `${SHARED_STATE_READ_WRITE_BASE_SYSTEM}\n\n${preamble}`;
}

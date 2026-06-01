import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { writeNotesToWorkingMemory } from "./working-memory";

// @region[set-notes-tool-backend]
/**
 * Backend-side tool the LLM calls to update the `notes` slot in shared state.
 *
 * Mirrors the LangGraph-Python `set_notes` reference: the tool always receives
 * the FULL updated notes list (existing notes + any new ones).
 *
 * Determinism: this tool writes the new notes array to the agent's working
 * memory DIRECTLY (`writeNotesToWorkingMemory`), instead of relying on the
 * LLM to remember to call Mastra's `updateWorkingMemory` in addition to this
 * tool. The AG-UI Mastra adapter emits a `STATE_SNAPSHOT` event whenever
 * working memory changes, which drives the live re-render of the notes card —
 * so as long as the write here lands, the UI updates regardless of whether
 * the LLM remembers anything.
 *
 * The returned JSON is what the LLM sees: notes echoed back plus an
 * `updated: true` flag confirming the write attempt completed (best-effort —
 * see `working-memory.ts` for the failure semantics).
 */
export const setNotesTool = createTool({
  id: "set_notes",
  description:
    "Replace the notes array in shared state with the FULL updated list of short note strings (existing notes + any new ones). Each note should be < 120 chars. Call this whenever the user asks you to remember something, or when you have an observation worth surfacing in the UI's notes panel. The tool persists the notes to working memory directly — you do not need to also call updateWorkingMemory.",
  inputSchema: z.object({
    notes: z
      .array(z.string())
      .describe(
        "Full updated notes list (existing notes plus any new ones). NOT a diff.",
      ),
  }),
  execute: async (inputData, executionContext) => {
    const notes = inputData.notes ?? [];
    await writeNotesToWorkingMemory(executionContext, notes);
    return JSON.stringify({ notes, updated: true as const });
  },
});
// @endregion[set-notes-tool-backend]

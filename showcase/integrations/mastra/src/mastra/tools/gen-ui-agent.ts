import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { writeStepsToWorkingMemory } from "./working-memory";

// @region[set-steps-tool-backend]
/**
 * Step shape published to the `steps` slot in shared state. Matches the
 * `Step` TypedDict in the langgraph-python `gen_ui_agent.py` reference and
 * the `StepSchema` in `langgraph-typescript/src/agent/gen-ui-agent.ts`.
 *
 * Status transitions: pending -> in_progress -> completed.
 */
const StepSchema = z.object({
  id: z.string().describe("Unique identifier for the step."),
  title: z.string().describe("Short description of the step."),
  status: z
    .enum(["pending", "in_progress", "completed"])
    .describe("Current status of the step."),
});

/**
 * Backend-side tool the LLM calls every time a plan step transitions.
 *
 * Mirrors the LangGraph/langgraph-typescript `set_steps` reference: the
 * tool always receives the FULL updated list of steps with their current
 * statuses (not a diff). The system prompt walks the model through the
 * pending -> in_progress -> completed chain.
 *
 * Determinism: this tool writes the new steps array to the agent's working
 * memory DIRECTLY (`writeStepsToWorkingMemory`) instead of relying on the
 * LLM to also call Mastra's `updateWorkingMemory`. The AG-UI Mastra adapter
 * emits a `STATE_SNAPSHOT` whenever working memory changes, which drives
 * the live re-render of the progress card on the frontend.
 *
 * The returned JSON is what the LLM sees: a short echo so the next turn
 * has a well-formed tool-result and continues the chain.
 */
export const setStepsTool = createTool({
  id: "set_steps",
  description:
    "Publish the current plan + step statuses. Call this every time a step transitions (including the first enumeration of steps). Always pass the FULL list of steps with their current statuses — never a diff.",
  inputSchema: z.object({
    steps: z
      .array(StepSchema)
      .describe(
        "The full list of steps with their current statuses (pending, in_progress, completed).",
      ),
  }),
  execute: async (inputData, executionContext) => {
    const steps = inputData.steps ?? [];
    await writeStepsToWorkingMemory(executionContext, steps);
    return JSON.stringify({ published: steps.length, updated: true as const });
  },
});
// @endregion[set-steps-tool-backend]

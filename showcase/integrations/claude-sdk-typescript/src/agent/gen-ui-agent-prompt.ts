/**
 * Gen UI (Agent-based) demo — backend agent constants.
 *
 * Mirrors `src/agent/gen-ui-agent.ts` in the langgraph-typescript sibling
 * (itself ported from `src/agents/gen_ui_agent.py` in langgraph-python).
 * The agent plans a task as 3 steps and walks each one
 * pending -> in_progress -> completed, calling the backend `set_steps`
 * tool after every transition. Each call REPLACES `state.steps`
 * wholesale (last-write-wins) and is streamed to the UI via
 * STATE_SNAPSHOT, so the frontend's `InlineAgentStateCard` re-renders a
 * live progress card from `useAgent` state.
 *
 * The step shape matches the frontend's `Step` type
 * (`src/app/demos/gen-ui-agent/InlineAgentStateCard.tsx`):
 *   { id: string, title: string, status: "pending" | "in_progress" | "completed" }
 */

import type Anthropic from "@anthropic-ai/sdk";

export const GEN_UI_AGENT_SYSTEM_PROMPT =
  "You are an agentic planner. For each user request, follow this exact " +
  "sequence:\n" +
  "1. Plan exactly 3 concrete steps and call `set_steps` ONCE with all " +
  'three steps at status="pending".\n' +
  '2. Step 1: call `set_steps` with step 1 at status="in_progress", ' +
  'then call `set_steps` again with step 1 at status="completed".\n' +
  '3. Step 2: call `set_steps` with step 2 at status="in_progress", ' +
  'then call `set_steps` again with step 2 at status="completed".\n' +
  '4. Step 3: call `set_steps` with step 3 at status="in_progress", ' +
  'then call `set_steps` again with step 3 at status="completed".\n' +
  "5. Send ONE final conversational assistant message summarizing the " +
  "plan, then stop. Do not call any more tools after step 3 is " +
  "completed.\n" +
  "\n" +
  "Rules: never call set_steps in parallel — always wait for one call to " +
  "return before the next. After all three steps are completed you MUST " +
  "send a final assistant message and terminate.";

export const SET_STEPS_TOOL_SCHEMA: Anthropic.Tool = {
  name: "set_steps",
  description:
    "Publish the current plan + step statuses. Call this every time a " +
    "step transitions (including the first enumeration of steps). The " +
    "list REPLACES the previous one, so always pass the full list.",
  input_schema: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        description: "The full list of steps with their current statuses.",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Unique identifier for the step.",
            },
            title: {
              type: "string",
              description: "Short description of the step.",
            },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed"],
              description: "Current status of the step.",
            },
          },
          required: ["id", "title", "status"],
        },
      },
    },
    required: ["steps"],
  },
};

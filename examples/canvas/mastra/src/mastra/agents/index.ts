import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { Memory } from "@mastra/memory";
import { completePlan, setPlan, updatePlanProgress } from "@/mastra/tools";

// Canvas Agent working memory schema mirrors the front-end AgentState
export const AgentState = z.object({
  // Avoid z.any() to ensure valid JSON schema for OpenAI tools
  // Use a permissive object so the array has a defined 'items' schema
  items: z
    .array(
      z
        .object({ id: z.string().optional() })
        .passthrough()
    )
    .default([]),
  globalTitle: z.string().default(""),
  globalDescription: z.string().default(""),
  lastAction: z.string().default(""),
  itemsCreated: z.number().int().default(0),
  planSteps: z.array(z.object({
    title: z.string(),
    status: z.enum(["pending", "in_progress", "completed", "blocked", "failed"]),
    note: z.string().optional(),
  })).default([]),
  currentStepIndex: z.number().int().default(-1),
  planStatus: z.string().default(""),
});

export const canvasAgent = new Agent({
  name: "sample_agent",
  description: "Canvas agent powering CopilotKit AG-UI interactions.",
  tools: { setPlan, updatePlanProgress, completePlan },
  model: openai("gpt-4o-mini"),
  instructions: "You are a helpful assistant managing a canvas of items. Prefer shared state over chat history.",
  memory: new Memory({
    options: {
      workingMemory: {
        enabled: true,
        schema: AgentState,
      },
    },
  }),
});

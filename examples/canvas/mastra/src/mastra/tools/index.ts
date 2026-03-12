import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const setPlan = createTool({
  id: 'set_plan',
  description: 'Initialize a plan consisting of step descriptions. Resets progress and sets status to in_progress.',
  inputSchema: z.object({
    steps: z.array(z.string()).describe('List of step titles'),
  }),
  outputSchema: z.object({ initialized: z.literal(true), steps: z.array(z.string()) }),
  execute: async ({ context }) => {
    return { initialized: true as const, steps: context.steps };
  },
});

export const updatePlanProgress = createTool({
  id: 'update_plan_progress',
  description: 'Update a single plan step\'s status, and optionally add a note.',
  inputSchema: z.object({
    step_index: z.number().int().nonnegative(),
    status: z.enum(["pending", "in_progress", "completed", "blocked", "failed"]),
    note: z.string().optional(),
  }),
  outputSchema: z.object({ updated: z.literal(true), index: z.number(), status: z.string(), note: z.string().nullable() }),
  execute: async ({ context }) => {
    return { updated: true as const, index: context.step_index, status: context.status, note: context.note ?? null };
  },
});

export const completePlan = createTool({
  id: 'complete_plan',
  description: 'Mark the plan as completed.',
  inputSchema: z.object({}),
  outputSchema: z.object({ completed: z.literal(true) }),
  execute: async () => {
    return { completed: true as const };
  },
});


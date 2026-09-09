// @region[background-research-tool]
/**
 * Backgroundable deep-research tool for the Background Agents demo.
 *
 * Mastra natively supports background tasks: a tool marked
 * `background: { enabled: true }` is dispatched to Mastra's
 * BackgroundTaskManager instead of running inline in the agentic loop
 * (the manager itself is enabled on the Mastra instance via
 * `new Mastra({ backgroundTasks: { enabled: true } })` — see
 * `src/mastra/index.ts`). When the model calls this tool, Mastra emits a
 * `background-task-started` lifecycle chunk on the run stream and returns
 * a placeholder tool-result so the conversation can continue.
 *
 * MastraAgent (the AG-UI adapter) maps that lifecycle chunk to an AG-UI
 * `ACTIVITY_SNAPSHOT` (activity type `mastra-background-task`) carrying the
 * task's status, and SUPPRESSES the normal tool-call render — so the work
 * surfaces ONLY as a live "working" activity card, never as an orphan tool
 * pill. The Copilot Runtime forwards those activity events to the client,
 * where a `renderActivityMessages` renderer paints the card.
 *
 * Terminal-state note: on the dispatching run's stream Mastra emits the
 * `started` lifecycle plus a placeholder result; the real completion is
 * delivered out of band (a later turn), so within this turn the card's
 * status stays `running`. The demo is intentionally designed around the
 * "working" state.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const runDeepResearchTool = createTool({
  id: "run_deep_research",
  description:
    "Kick off a long-running deep-research task on a topic. This runs in " +
    "the background while the conversation continues — call it once when " +
    "the user asks to research, investigate, or dig into a topic.",
  inputSchema: z.object({
    topic: z.string().describe("The topic to research in depth."),
  }),
  // Marks this tool eligible for background execution. Combined with the
  // instance-level `backgroundTasks: { enabled: true }`, a call to this
  // tool is dispatched to the BackgroundTaskManager and emits a
  // `background-task-started` lifecycle chunk.
  background: { enabled: true },
  execute: async ({ topic }) => {
    // This body only runs when the task is actually executed by the
    // background worker. On the dispatching turn Mastra returns a
    // placeholder result instead, so the demo does not depend on this
    // value being surfaced within the turn.
    return JSON.stringify({
      topic,
      summary: `Deep research on "${topic}" completed.`,
    });
  },
});
// @endregion[background-research-tool]

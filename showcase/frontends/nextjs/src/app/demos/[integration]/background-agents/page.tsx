"use client";

/**
 * Background Agents demo.
 *
 * Mastra runs background tasks natively. The `background-agents` agent has a
 * `run_deep_research` tool with `background: { enabled: true }`. When the
 * agent calls it, Mastra gives the work to its BackgroundTaskManager instead
 * of running it inline. The Mastra AG-UI adapter reports the task as an
 * activity (activity type `mastra-background-task`), not as a tool call. The
 * renderer that this page registers through `renderActivityMessages` draws
 * that activity as a live "working" card.
 *
 * The standard `<CopilotChat />` shows activity messages inline in the
 * transcript with the registered renderer, so no custom message list is
 * needed.
 *
 * In the turn that dispatches the task, Mastra sends the task's `started`
 * lifecycle and a placeholder result. Completion arrives out of band, so the
 * card stays in the "working" state for the rest of that turn.
 */

import { CopilotKit } from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { Chat } from "./chat";
import { backgroundTaskActivityRenderer } from "./activity-card";

// CopilotKit needs the same array on every render.
const activityRenderers = [backgroundTaskActivityRenderer];

export default function BackgroundAgentsDemo() {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("background-agents")}
      agent="background-agents"
      renderActivityMessages={activityRenderers}
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

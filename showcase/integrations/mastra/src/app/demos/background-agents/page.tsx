"use client";

/**
 * Background Agents demo.
 *
 * Mastra natively supports background tasks. The `background-agents` agent
 * wires a `run_deep_research` tool flagged `background: { enabled: true }`.
 * When the agent calls it, Mastra dispatches the work to its
 * BackgroundTaskManager instead of running it inline, and MastraAgent surfaces
 * that as an AG-UI activity event (activity type `mastra-background-task`)
 * rather than a normal tool pill. The Copilot Runtime forwards the activity to
 * the client, where the `backgroundTaskActivityRenderer` registered below via
 * `renderActivityMessages` paints a live "working" card.
 *
 * The standard `<CopilotChat />` renders activity messages inline in the
 * transcript using the registered renderer — no custom message list needed.
 *
 * Terminal-state note: on the dispatching turn Mastra delivers the task's
 * `started` lifecycle plus a placeholder result and defers real completion out
 * of band, so within the turn the card stays in the "working" state.
 *
 * Runtime: `src/app/api/copilotkit-background-agents/route.ts`.
 */

import React from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { Chat } from "./chat";
import { backgroundTaskActivityRenderer } from "./activity-card";

export default function BackgroundAgentsDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-background-agents"
      agent="background-agents"
      renderActivityMessages={[backgroundTaskActivityRenderer]}
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

"use client";

/**
 * Observational Memory demo.
 *
 * Observational Memory (OM) is a feature of Mastra's `Memory`. As the
 * conversation grows past a token threshold, Mastra runs an Observer out of
 * band. The Observer reads the unobserved messages, compresses them into
 * structured observations, and activates them into the working context.
 * Mastra streams that background work on the run's `fullStream` as typed
 * `data-om-*` chunks.
 *
 * The Mastra AG-UI adapter maps those chunks to AG-UI activity events
 * (activity type `mastra-observational-memory`) when the agent is built with
 * `observationalMemory: true` (see `src/integrations/mastra/agents.ts`). This
 * page registers a custom activity renderer through `renderActivityMessages`,
 * so the "agent is compressing or activating memory" work renders inline as a
 * separate card in the chat transcript.
 *
 * OM fires on the token size of the unobserved messages, not on the number of
 * turns. The two suggestion pills send long multi-paragraph messages on
 * purpose, so a single click crosses the threshold and the Observer runs.
 */

import { CopilotKit } from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { Chat } from "./chat";
import { observationalMemoryActivityRenderer } from "./activity-renderer";

// CopilotKit needs the same array on every render.
const activityRenderers = [observationalMemoryActivityRenderer];

export default function ObservationalMemoryDemo() {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("observational-memory")}
      agent="observational-memory"
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

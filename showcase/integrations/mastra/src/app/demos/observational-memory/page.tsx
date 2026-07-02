"use client";

/**
 * Observational Memory demo (Mastra).
 *
 * Observational Memory (OM) is a Mastra `Memory` feature: as the conversation
 * grows past a token threshold, Mastra runs an Observer OUT OF BAND that reads
 * the unobserved messages, compresses them into structured observations, and
 * activates them into the working context. Mastra streams that background work
 * on the run's `fullStream` as typed `data-om-*` chunks.
 *
 * The AG-UI Mastra adapter maps those chunks to AG-UI activity events
 * (activityType `mastra-observational-memory`) when the surfacing toggle is on
 * (see `src/app/api/copilotkit-observational-memory/route.ts`). We register a
 * custom activity renderer via `<CopilotKit renderActivityMessages={...}>` so
 * the "agent is compressing / activating memory" work renders inline as a
 * distinct card in the chat transcript.
 *
 * TRIGGER: OM fires on unobserved MESSAGE-TOKEN SIZE, not turn count. The two
 * suggestion pills send deliberately large multi-paragraph messages so a
 * single click crosses the threshold and the Observer runs.
 */

import React from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { Chat } from "./chat";
import { observationalMemoryActivityRenderer } from "./activity-renderer";

export default function ObservationalMemoryDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-observational-memory"
      agent="observational-memory"
      renderActivityMessages={[observationalMemoryActivityRenderer]}
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

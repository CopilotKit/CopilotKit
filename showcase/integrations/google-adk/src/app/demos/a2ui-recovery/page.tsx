"use client";

/**
 * A2UI Error Recovery demo (ADK-only).
 *
 * Same dynamic-schema A2UI setup as declarative-gen-ui (it reuses that demo's
 * catalog), but it makes the middleware's validate->retry recovery loop
 * visible. The dedicated runtime at `/api/copilotkit-a2ui-recovery` is
 * configured with `injectA2UITool: false` — the backend agent
 * (`src/agents/recovery_agent.py`) owns `generate_a2ui` via the ag-ui-adk
 * >= 0.7.0 middleware, which runs the forced `render_a2ui` sub-agent and the
 * recovery loop + recovery-exhausted hard-fail envelope (OSS-158).
 *
 * The two suggestion pills drive aimock fixtures that force:
 *   - HEAL: an invalid first render that recovers to a valid one
 *     (building -> retrying -> painted).
 *   - EXHAUST: an always-invalid render that hits the attempt cap
 *     (a tasteful `failed` state, never a broken surface).
 *
 * Recovery lives in the ADK middleware, not the runtime path langgraph-python
 * uses — which is why this demo is ADK-only.
 */

import React from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";

// Reuse the declarative-gen-ui catalog (same components, same catalogId).
import { myCatalog } from "../declarative-gen-ui/a2ui/catalog";
import { Chat } from "./chat";

export default function A2uiRecoveryDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-a2ui-recovery"
      agent="a2ui-recovery"
      a2ui={{ catalog: myCatalog }}
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

"use client";

/**
 * A2UI Error Recovery demo.
 *
 * Same dynamic-schema A2UI setup as declarative-gen-ui (it reuses that demo's
 * catalog), but it makes the validate->retry recovery loop visible. The
 * dedicated runtime at `/api/copilotkit-a2ui-recovery` is configured with
 * `injectA2UITool: false` — the backend agent (`src/agents/recovery_agent.py`)
 * owns `generate_a2ui` itself, whose body runs the forced `render_a2ui`
 * sub-agent and a NATIVE validate->retry recovery loop + recovery-exhausted
 * hard-fail envelope in the Claude backend (OSS-158 / OSS-375). Unlike the
 * langgraph-python reference, claude-sdk-python uses its own adapter
 * (ag-ui-claude-sdk + claude-agent-sdk) and does NOT route through the shared
 * `ag_ui_langgraph` recovery loop — the loop is re-implemented natively so the
 * `render_a2ui` per-attempt calls (aimock `sequenceIndex`) and the
 * `a2ui_recovery_exhausted` envelope match the middleware's expectations.
 *
 * The two suggestion pills drive aimock fixtures that force:
 *   - HEAL: an invalid first render that recovers to a valid one
 *     (building -> retrying -> painted).
 *   - EXHAUST: an always-invalid render that hits the attempt cap
 *     (a tasteful `failed` state, never a broken surface).
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

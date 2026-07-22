"use client";

/**
 * A2UI Error Recovery demo (Mastra, OSS-422).
 *
 * Same dynamic-schema A2UI setup as declarative-gen-ui (it reuses that demo's
 * catalog), but it makes the toolkit's validate->retry recovery loop visible.
 * The dedicated runtime at `/api/copilotkit-a2ui-recovery` is configured with
 * `a2ui.injectA2UITool: false` — the backend agent (`a2uiRecoveryAgent`) owns
 * `generate_a2ui` via `getA2UITools`, whose body runs the forced `render_a2ui`
 * sub-agent and the recovery loop + recovery-exhausted hard-fail envelope
 * (OSS-413 feature; mirrors langgraph-python + strands recovery cells).
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

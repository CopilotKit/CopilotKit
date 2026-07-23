"use client";

/**
 * A2UI Error Recovery demo.
 *
 * Same auto-injected dynamic-schema A2UI setup as declarative-gen-ui (it reuses
 * that demo's catalog), but it makes the toolkit's validate->retry recovery loop
 * visible. The dedicated runtime at `/api/copilotkit-a2ui-recovery` proxies to a
 * dedicated backend agent (`src/agents/recovery_agent.py`); the page's provider
 * catalog auto-enables A2UI tool injection, so the Strands adapter auto-injects
 * `generate_a2ui`, drives the forced `render_a2ui` sub-agent, and runs the
 * recovery loop + recovery-exhausted hard-fail envelope (OSS-158 / OSS-375).
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

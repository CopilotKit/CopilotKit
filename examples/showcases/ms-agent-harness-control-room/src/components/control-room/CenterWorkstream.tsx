"use client";

/**
 * Center column: the conversational chat with the Control Room agent.
 *
 * As of Task 6, primitive renderers (shell output, file reads, diff
 * proposals, approval cards, generated results, observer snapshots) are
 * registered globally by `<ToolRendererRegistry />` (mounted inside
 * `<CopilotKit>` in `ControlRoomApp`). The chat surface itself renders each
 * tool call inline as it streams, so the dashed "Task 6 mounting slot" cards
 * that previously lived here are gone.
 */

import {
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import { CONTROL_ROOM_AGENT_NAME } from "@/hooks/use-control-room-state";

export function CenterWorkstream() {
  // v2's suggestion engine: registers a "static" suggestion the agent surfaces
  // as a starter pill in the chat input. The cockpit only ships one — fix the
  // seeded failing test — but the registry can take any number.
  useConfigureSuggestions({
    instructions: "Fix the seeded failing test in the fixture repo.",
    minSuggestions: 1,
    maxSuggestions: 1,
    consumerAgentId: CONTROL_ROOM_AGENT_NAME,
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div
          className="flex shrink-0 items-center gap-3 border-b border-[var(--cr-border)] bg-[var(--cr-surface-2)] px-4 py-2.5"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          <span className="cr-pip" data-tone="amber" aria-hidden />
          <div className="flex-1">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--cr-fg-strong)]">
              Agent Workstream
            </h2>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--cr-muted)]">
              Tool calls, approvals, file edits stream inline · gpt-5.4
            </p>
          </div>
          <span className="cr-chip">AG-UI · live</span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <CopilotChat
            agentId={CONTROL_ROOM_AGENT_NAME}
            labels={{
              modalHeaderTitle: "Control Room",
              welcomeMessageText:
                "Mission ready. Ask me to fix the seeded failing test in the fixture repo, or describe another task in the same workspace.",
              chatDisclaimerText: "",
            }}
          />
        </div>
      </div>
    </div>
  );
}

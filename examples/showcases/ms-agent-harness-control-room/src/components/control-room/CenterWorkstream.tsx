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

function HiddenCopyButton() {
  return null;
}

const chatMessageView = {
  assistantMessage: {
    copyButton: HiddenCopyButton,
  },
  userMessage: {
    copyButton: HiddenCopyButton,
  },
};

export function CenterWorkstream() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Plan repair + health table",
        message:
          "Run this as exactly one complete read-only planning interaction. Follow this order only, one Harness tool per model step: load the fixture-diagnosis skill; switch to or confirm Plan mode; call TodoList_Add with a concise four-item pending repair checklist for the known seeded bug; wait for the TodoList_Add result; read calculator.ts with FileAccess_ReadFile; read calculator.test.ts with FileAccess_ReadFile; identify the seeded bug in one sentence: add(a, b) returns subtraction instead of addition; then render exactly one showRunHealthTable as the final action. Do not call TodoList_Complete, FileMemory, shell commands, or file edit tools in this pill. Do not ask me to continue. It is a demo failure if showRunHealthTable appears before the TodoList_Add and file-read event cards are complete.",
      },
      {
        title: "Estimate timeline",
        message:
          "Run this as a complete read-only stage interaction. Estimate a realistic presenter timeline for the seeded calculator repair. If no plan exists yet, first read calculator.ts and calculator.test.ts without editing or running shell commands, then identify the seeded bug in one sentence: add(a, b) returns subtraction instead of addition. Complete any state or file tool calls first and wait for their results. Then render exactly one showRepairCalendar as the final action with approval, patch, verification, and handoff milestones. Do not call showRepairCalendar in the same tool-call step as any Harness tool.",
      },
      {
        title: "Show capability coverage",
        message:
          "Run this as a complete read-only stage interaction. Give a capability tour of what Microsoft Agent Harness coordinates in this demo: planning, todos, skills, memory, file access, shell tools, approvals, and verification. Ground it in the seeded calculator repair story without editing files or running shell commands. Complete any state inspection first and wait for the tool result. Then render exactly one showCapabilityRadar as the final action with realistic coverage scores for the repair flow. Do not call showCapabilityRadar in the same tool-call step as any Harness tool.",
      },
      {
        title: "Run with approval readiness",
        message:
          "Run this as a complete approval interaction. If the bug has not been identified yet, read calculator.ts and calculator.test.ts first and identify the seeded bug: add(a, b) returns subtraction instead of addition. Switch to Act mode. Apply the one-line calculator.ts patch so add(a, b) returns a + b. Then call the real Harness approval-gated pnpm_run command \"test\" so the presenter sees the actual approval card. Pause while that real approval card is waiting for presenter approval. After approval, continue automatically: if the test reports missing node_modules or vitest not found, call pnpm_run \"install\", wait for it to finish, then call pnpm_run \"test\" again. Do not ask whether to continue after missing dependencies. Do not render any show* generative UI in this pill.",
      },
      {
        title: "Verify and hand off",
        message:
          "Run this as a complete handoff interaction. First inspect the current fixture status. If there is no clear evidence in this session that calculator.ts was patched and pnpm_run tests ran, do not ask to verify now; instead produce a preview handoff that says verification is pending. Do not claim the implementation is correct unless test evidence exists. The seeded bug is add(a, b) returning subtraction instead of addition until a patch and tests prove otherwise. Save a short preview or final post-mortem to Harness file memory. Wait for the FileMemory_SaveFile result. Then render exactly one showHandoffForm as the final action with the current owner, memory note, and follow-up checklist. Do not call showHandoffForm in the same tool-call step as FileMemory_SaveFile or any Harness tool. Do not render showHarnessSummary or showApprovalReadinessForm for this pill.",
      },
    ],
    available: "before-first-message",
    consumerAgentId: CONTROL_ROOM_AGENT_NAME,
  });

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <CopilotChat
        agentId={CONTROL_ROOM_AGENT_NAME}
        className="h-full w-full"
        messageView={chatMessageView}
        labels={{
          modalHeaderTitle: "Control Room",
        }}
      />
    </div>
  );
}

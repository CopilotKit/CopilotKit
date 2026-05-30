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
          "Load the fixture-diagnosis skill, switch to Plan mode, inspect the top-level calculator.ts and calculator.test.ts files, identify the calculator bug, create a concise todo list, and render showRunHealthTable plus showHarnessSummary with realistic Harness state. Do not edit files or run shell commands.",
      },
      {
        title: "Estimate timeline",
        message:
          "Using the current repair plan and Harness state, estimate a realistic repair timeline. If no plan exists yet, first inspect calculator.ts and calculator.test.ts without editing. Render showRepairCalendar and showHarnessSummary, and keep the explanation concise.",
      },
      {
        title: "Show capability coverage",
        message:
          "Give a capability tour of what Microsoft Agent Harness is coordinating in this demo: planning, todos, skills, memory, file access, shell tools, approvals, and verification. Render showCapabilityRadar and showToolUsageDonut with demo data grounded in the current run. Do not edit files.",
      },
      {
        title: "Run with approval readiness",
        message:
          "Switch to Act mode, apply the smallest calculator.ts patch for the identified bug, then render showApprovalReadinessForm for the approval-gated pnpm_run test command. If approval is granted, run pnpm_run with command \"test\" and render showRepairTrendChart with the result.",
      },
      {
        title: "Verify and hand off",
        message:
          "Run final verification with pnpm_run command \"test:coverage\", save a short post-mortem to Harness file memory, then render showCoverageAreaChart, showHandoffForm, and showHarnessSummary for the final state.",
      },
    ],
    available: "always",
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

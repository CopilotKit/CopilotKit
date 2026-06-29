import { z } from "zod";

import {
  useHumanInTheLoop,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";
import {
  createOpenBoxApprovalClient,
  OpenBoxGovernanceDecision,
  useOpenBoxCopilotKit,
} from "@openbox-ai/openbox-sdk/copilotkit/react";

import { OpenBoxBusinessActionResult } from "@/components/openbox-business-result";
import { withBasePath } from "@/lib/base-path";
import { openBoxDemoScenarios } from "@/lib/openbox-demo-scenarios";
import { markOpenBoxSessionHalted } from "@/lib/openbox-halt-state";
import {
  useOpenBoxLiveTimingValue,
  withOpenBoxLiveTimingProps,
} from "@/lib/openbox-live-timing";

export const useGenerativeUIExamples = () => {
  const openBoxTheme = {
    logoSrc: withBasePath("/openbox-mark.png"),
    accentColor: "#3B9AF5",
    radius: 8,
    density: "comfortable" as const,
    mode: "auto" as const,
  };

  useOpenBoxCopilotKit({
    bindings: {
      useHumanInTheLoop: useHumanInTheLoop as any,
      useDefaultRenderTool: useDefaultRenderTool as any,
    },
    approvalParameters: z.object({
      action: z.string().describe("The sensitive action being reviewed."),
      request: z.string().describe("The original user request."),
      destination: z
        .string()
        .optional()
        .describe("External destination, if any."),
      amountUsd: z
        .number()
        .optional()
        .describe("The amount in USD if the action moves money."),
      riskReason: z
        .string()
        .optional()
        .describe("Why OpenBox requires human approval."),
      workflowId: z
        .string()
        .describe(
          "OpenBox workflow ID from the approval_required tool result.",
        ),
      runId: z
        .string()
        .describe("OpenBox run ID from the approval_required tool result."),
      activityId: z
        .string()
        .describe(
          "OpenBox activity ID from the approval_required tool result.",
        ),
      approvalId: z.string().optional().describe("OpenBox approval ID."),
      governanceEventId: z
        .string()
        .describe(
          "OpenBox governance event ID from the approval_required tool result.",
        ),
      expiresAt: z
        .string()
        .optional()
        .describe("OpenBox approval expiration timestamp."),
    }),
    interactiveParameters: z.object({
      mode: z.enum(["choice", "manual"]),
      title: z.string(),
      request: z.string(),
      action: z.enum([
        "review_data_handoff",
        "submit_manual_request",
        "view_governance_report",
        "draft_policy_constrained_message",
      ]),
      destination: z.string().optional(),
      fields: z.array(z.string()).optional(),
      audience: z.string().optional(),
      manualInput: z.string().optional(),
      sensitivity: z
        .enum(["public", "internal", "confidential", "restricted"])
        .optional(),
      choiceId: z.enum(["minimal", "growth", "sensitive"]).optional(),
    }),
    theme: openBoxTheme,
    scenarios: openBoxDemoScenarios as any,
    approvalClient: createOpenBoxApprovalClient({
      endpoint: withBasePath("/api/openbox/approvals/decide"),
    }),
    renderGovernanceDecision: (props) => {
      return (
        <OpenBoxGovernanceDecisionWithLiveTiming
          props={props}
          theme={openBoxTheme}
          scenarios={openBoxDemoScenarios as any}
        />
      );
    },
    renderActionResult: ({ result }) => (
      <OpenBoxBusinessActionResult result={result} />
    ),
    onSessionHalted: markOpenBoxSessionHalted,
  });
};

function OpenBoxGovernanceDecisionWithLiveTiming({
  props,
  theme,
  scenarios,
}: {
  props: Record<string, unknown>;
  theme: Record<string, unknown>;
  scenarios: unknown;
}) {
  const liveTiming = useOpenBoxLiveTimingValue();
  const timedProps = withOpenBoxLiveTimingProps(props as any, liveTiming);

  return (
    <OpenBoxGovernanceDecision
      {...(timedProps as any)}
      theme={theme as any}
      scenarios={scenarios as any}
    />
  );
}

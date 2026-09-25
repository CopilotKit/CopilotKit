"use client";

import type { BrowserPageMap } from "@copilotkit/core";
import { BrowserFormBatch } from "@copilotkit/core";
import { useCopilotKit, useFrontendTool } from "@copilotkit/react-core/v2";
import { useMemo } from "react";
import { z } from "zod";
import {
  approvalController,
  orderApprovalGate,
  rememberUnsettledEffect,
} from "@/lib/autopilot-approval";
import type { SessionUser } from "@/lib/db";
import { consumeAutopilotBudget } from "@/lib/autopilot-budget";

type FormOutcome = {
  status: "completed" | "failed" | "uncertain";
  recordId?: string;
  version?: number;
  reason?: string;
};

function observeOutcome(form: HTMLFormElement): {
  result: Promise<FormOutcome>;
  cancel: () => void;
} {
  let cancel = () => {};
  const result = new Promise<FormOutcome>((resolve) => {
    const onOutcome = (event: Event) => {
      cleanup();
      resolve((event as CustomEvent<FormOutcome>).detail);
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve({
        status: "uncertain",
        reason: "No form completion receipt arrived",
      });
    }, 15_000);
    const cleanup = () => {
      window.clearTimeout(timer);
      form.removeEventListener("copilotkit:autopilot-form-outcome", onOutcome);
    };
    cancel = cleanup;
    form.addEventListener("copilotkit:autopilot-form-outcome", onOutcome);
  });
  return { result, cancel };
}

export function AutopilotFormTool({
  pageMap,
  user,
}: {
  pageMap: BrowserPageMap;
  user: SessionUser;
}) {
  const { copilotkit } = useCopilotKit();
  const batch = useMemo(() => new BrowserFormBatch(pageMap), [pageMap]);
  useFrontendTool({
    name: "autopilot_submitForm",
    autopilot: true,
    description:
      "Request one reviewed form operation using up to 12 discovered native fields or supported custom selects. Pass field refs, exact values, and the submit button ref. Calling this tool opens the app's review UI and waits for the human decision before any input event; do not ask for a separate chat confirmation. Do not claim success unless the receipt says completed.",
    parameters: z.object({
      changes: z
        .array(
          z.object({
            ref: z.string().min(1).max(30),
            value: z.string().max(2_000),
          }),
        )
        .min(1)
        .max(12),
      submitRef: z.string().min(1).max(30),
    }),
    handler: async ({ changes, submitRef }, context) => {
      let operationId: string | undefined;
      let dispatched = false;
      try {
        const budgetDecision = await consumeAutopilotBudget(
          user,
          context,
          "action",
        );
        if (!budgetDecision.allowed)
          return {
            status: "denied",
            reason: budgetDecision.reason,
            remainingActionBudget: 0,
          };
        if (!context.agent?.agentId || !context.agent.threadId)
          throw new Error("An active agent thread is required");
        const plan = batch.prepare(changes, submitRef);
        const target = {
          userId: user.id,
          organizationId: user.organizationId,
          recordId: plan.recordId,
          version: plan.version,
          action: plan.action,
          path: plan.path,
        };
        const userMessage = [...context.agent.messages]
          .toReversed()
          .find((message) => message.role === "user");
        const recheck = async () => {
          if (
            context.signal?.aborted ||
            !copilotkit.isAutopilotEnabledForAgent(context.agent!.agentId!) ||
            window.location.pathname !== plan.path
          )
            return false;
          const session = await fetch("/api/session", { cache: "no-store" });
          if (!session.ok) return false;
          const current = (await session.json()) as {
            userId: string;
            organizationId: string;
            role: string;
          };
          return (
            current.userId === user.id &&
            current.organizationId === user.organizationId &&
            current.role !== "viewer"
          );
        };
        const binding = {
          target,
          tool: "autopilot_submitForm",
          handlerVersion: "1",
          normalizedArguments: JSON.stringify({ changes, submitRef }),
          agentId: context.agent.agentId,
          threadId: context.agent.threadId,
          requestId: userMessage?.id ?? context.toolCall.id,
          toolCallId: context.toolCall.id,
          controlRef: submitRef,
        };
        const operation = orderApprovalGate.begin(
          binding,
          recheck,
          context.signal,
          60_000,
          () => ({
            ...binding,
            target: {
              ...target,
              recordId:
                plan.form.getAttribute("data-autopilot-record-id") ||
                plan.form.getAttribute("data-autopilot-draft-id") ||
                "",
              version: plan.form.hasAttribute("data-autopilot-record-id")
                ? Number(
                    plan.form.getAttribute("data-autopilot-record-version"),
                  )
                : 0,
              action: plan.form.hasAttribute("data-autopilot-record-id")
                ? "edit_form"
                : "create_form",
              path: window.location.pathname,
            },
            handlerVersion:
              plan.form.getAttribute("data-autopilot-handler-version") ?? "",
            agentId: context.agent?.agentId ?? "",
            threadId: context.agent?.threadId ?? "",
            requestId:
              [...(context.agent?.messages ?? [])]
                .toReversed()
                .find((message) => message.role === "user")?.id ??
              context.toolCall.id,
            toolCallId: context.toolCall.id,
          }),
        );
        operationId = operation.operationId;
        const review = [
          `${plan.review.form}?`,
          ...plan.review.fields.map(
            (field) =>
              `${field.label}: ${field.before || "(empty)"} → ${field.after || "(empty)"}`,
          ),
          `Then press ${plan.review.submit}.`,
        ].join("\n");
        const approval = await approvalController.request(
          {
            description: review,
            agentId: context.agent.agentId,
            threadId: context.agent.threadId,
          },
          context.signal,
        );
        if (approval === "cancelled") {
          orderApprovalGate.cancelAwaiting("Human stopped the action");
          return await operation.result;
        }
        const decision = await orderApprovalGate.decideFromApp(
          target,
          approval === "approved",
        );
        if (decision.mode !== "autopilot" || !decision.accepted)
          return await operation.result;
        rememberUnsettledEffect({
          operationId: decision.operationId,
          userId: user.id,
          organizationId: user.organizationId,
          agentId: context.agent.agentId,
          threadId: context.agent.threadId,
        });
        dispatched = true;
        const observer = observeOutcome(plan.form);
        try {
          const execution = await batch.dispatch(plan, recheck);
          if (execution.status !== "dispatched") {
            orderApprovalGate.finish(operationId, {
              status: execution.status,
              reason: `${execution.reason}; ${execution.applied} browser fields may have changed. The form was not submitted, and no server write was confirmed. Ask the user to review the form manually.`,
            });
            return await operation.result;
          }
          const outcome = await observer.result;
          if (
            outcome.status === "completed" &&
            outcome.recordId &&
            Number.isInteger(outcome.version)
          ) {
            orderApprovalGate.finish(operationId, {
              status: "completed",
              receipt: {
                recordId: outcome.recordId,
                version: outcome.version!,
                status: "saved",
              },
            });
          } else {
            orderApprovalGate.finish(operationId, {
              status:
                outcome.status === "completed" ? "uncertain" : outcome.status,
              reason: outcome.reason ?? "Form outcome was incomplete",
            });
          }
          return await operation.result;
        } finally {
          observer.cancel();
        }
      } catch (error) {
        if (operationId && dispatched) {
          orderApprovalGate.finish(operationId, {
            status: "uncertain",
            reason: "Dispatch outcome could not be observed",
          });
          return {
            status: "uncertain",
            reason: "Dispatch outcome could not be observed",
          };
        }
        if (operationId)
          orderApprovalGate.cancelAwaiting("Form action could not start");
        return {
          status: "failed",
          reason: error instanceof Error ? error.message : "Form action failed",
        };
      }
    },
  });
  return null;
}

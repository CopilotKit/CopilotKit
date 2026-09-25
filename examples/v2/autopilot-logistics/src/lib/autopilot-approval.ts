"use client";

import { BrowserApprovalGate } from "@copilotkit/core";
import { CopilotApprovalController } from "@copilotkit/react-core/v2/headless";

export const orderApprovalGate = new BrowserApprovalGate();
export const approvalController = new CopilotApprovalController();

export type UnsettledEffect = {
  operationId: string;
  userId: string;
  organizationId: string;
  agentId: string;
  threadId: string;
};

const storageKey = "copilotkit:unsettled-effects";
export const unsettledEffectEvent = "copilotkit:unsettled-effects-changed";

export function readUnsettledEffects(): UnsettledEffect[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(value)
      ? value.filter(
          (effect): effect is UnsettledEffect =>
            !!effect &&
            typeof effect.operationId === "string" &&
            typeof effect.userId === "string" &&
            typeof effect.organizationId === "string" &&
            typeof effect.agentId === "string" &&
            typeof effect.threadId === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function saveUnsettledEffects(effects: UnsettledEffect[]): void {
  sessionStorage.setItem(storageKey, JSON.stringify(effects));
  window.dispatchEvent(new Event(unsettledEffectEvent));
}

export function rememberUnsettledEffect(effect: UnsettledEffect): void {
  saveUnsettledEffects([
    ...readUnsettledEffects().filter(
      (item) => item.operationId !== effect.operationId,
    ),
    effect,
  ]);
}

export function clearUnsettledEffect(operationId: string): void {
  saveUnsettledEffects(
    readUnsettledEffects().filter((item) => item.operationId !== operationId),
  );
}

export function clearUserUnsettledEffects(userId: string): void {
  saveUnsettledEffects(
    readUnsettledEffects().filter((item) => item.userId !== userId),
  );
}

orderApprovalGate.onSettled((result) => {
  approvalController.cancel();
  if (result.status !== "uncertain" && result.status !== "partial")
    clearUnsettledEffect(result.operationId);
});

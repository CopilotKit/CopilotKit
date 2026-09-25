"use client";

import { BrowserApprovalGate } from "@copilotkit/core";
import { CopilotApprovalController } from "@copilotkit/react-core/v2/headless";

export const orderApprovalGate = new BrowserApprovalGate();
export const approvalController = new CopilotApprovalController();
orderApprovalGate.onSettled(() => approvalController.cancel());

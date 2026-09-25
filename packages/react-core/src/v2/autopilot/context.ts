import { createContext } from "react";
import type { CopilotApprovalController } from "../hooks/use-copilot-approval";
import type { CopilotClarificationController } from "../hooks/use-copilot-clarification";

export const AutopilotContext = createContext<
  | {
      approvalController: CopilotApprovalController;
      clarificationController: CopilotClarificationController;
      statusNotice?: { message: string; onDismiss(): void };
    }
  | undefined
>(undefined);

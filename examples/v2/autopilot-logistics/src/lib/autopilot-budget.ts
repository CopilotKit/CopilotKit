import { BrowserRequestBudget } from "@copilotkit/core";
import type { AutopilotBudgetKind } from "@copilotkit/core";
import type { SessionUser } from "./db";

const budget = new BrowserRequestBudget();

export async function consumeAutopilotBudget(
  user: SessionUser,
  context: {
    agent?: {
      agentId?: string;
      threadId?: string;
      messages: readonly { role: string; id?: string }[];
    };
  },
  kind: AutopilotBudgetKind,
) {
  const agent = context.agent;
  const requestId = [...(agent?.messages ?? [])]
    .toReversed()
    .find((message) => message.role === "user")?.id;
  return budget.consume(
    {
      userId: user.id,
      organizationId: user.organizationId,
      agentId: agent?.agentId ?? "",
      threadId: agent?.threadId ?? "",
      requestId: requestId ?? "",
    },
    kind,
  );
}

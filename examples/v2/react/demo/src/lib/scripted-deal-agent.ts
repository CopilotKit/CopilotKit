import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";

export const APPROVE_DEAL_TOOL = "approveDeal";

interface DealContext {
  dealId: string;
  amount: number;
}

const FALLBACK_DEAL: DealContext = { dealId: "deal-1", amount: 12000 };

function isDealContext(value: unknown): value is DealContext {
  if (typeof value !== "object" || value === null) return false;
  return "dealId" in value && "amount" in value;
}

/** Reads the deal the page shares through `useAgentContext`. */
function findDeal(input: RunAgentInput) {
  for (const entry of input.context) {
    try {
      const parsed: unknown = JSON.parse(entry.value);
      if (isDealContext(parsed)) return parsed;
    } catch {
      // Plain-text context entries are not the deal.
    }
  }
  return FALLBACK_DEAL;
}

function textMessage(messageId: string, text: string) {
  const words = text.split(" ");
  return words.map((word, index) => ({
    type: EventType.TEXT_MESSAGE_CHUNK,
    messageId,
    role: "assistant" as const,
    delta: index === 0 ? word : ` ${word}`,
  }));
}

/**
 * The events of one run, in order. No LLM: the script only looks at the last message.
 * A tool result for `approveDeal` gets a confirmation. Anything else gets a reply
 * plus an `approveDeal` call that the page renders as a human-in-the-loop prompt.
 */
export function scriptDealRun(input: RunAgentInput) {
  const deal = findDeal(input);
  const lastMessage = input.messages.at(-1);
  const replyId = `${input.runId}-reply`;
  const start = {
    type: EventType.RUN_STARTED,
    threadId: input.threadId,
    runId: input.runId,
  };
  const finish = {
    type: EventType.RUN_FINISHED,
    threadId: input.threadId,
    runId: input.runId,
  };

  if (lastMessage?.role === "tool") {
    return [
      start,
      ...textMessage(
        replyId,
        `Done. The approval for ${deal.dealId} was recorded: ${lastMessage.content}`,
      ),
      finish,
    ];
  }

  const toolCallId = `${input.runId}-approve`;
  return [
    start,
    ...textMessage(
      replyId,
      `Deal ${deal.dealId} is ready at $${deal.amount}. Please approve or reject it below.`,
    ),
    {
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId,
      toolCallName: APPROVE_DEAL_TOOL,
      parentMessageId: replyId,
      delta: JSON.stringify(deal),
    },
    finish,
  ];
}

/** A scripted agent for the learning demo. Streams each event with a short delay. */
export class ScriptedDealAgent extends AbstractAgent {
  constructor(private readonly delayMs = 40) {
    super();
  }

  clone() {
    return new ScriptedDealAgent(this.delayMs);
  }

  run(input: RunAgentInput) {
    return new Observable<BaseEvent>((observer) => {
      const events = scriptDealRun(input);
      let index = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const next = () => {
        const event = events[index];
        if (event === undefined) {
          observer.complete();
          return;
        }
        observer.next(event);
        index += 1;
        timer = setTimeout(next, this.delayMs);
      };
      next();
      return () => clearTimeout(timer);
    });
  }
}

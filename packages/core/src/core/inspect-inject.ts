import type {
  AbstractAgent,
  BaseEvent,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
import { from } from "rxjs";

import type { CopilotKitCore } from "./core";

export type InspectorInjectResult = {
  messageIds: string[];
};

const REMINT_ID_KEYS = [
  "messageId",
  "parentMessageId",
  "toolCallId",
  "runId",
] as const;

function newInspectorId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `cpk-inject-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function remintInspectorEventIds(
  events: ReadonlyArray<{ type: string; [key: string]: unknown }>,
): Array<{ type: string; [key: string]: unknown }> {
  const mapped = new Map<string, string>();
  const idFor = (value: string) => {
    const existing = mapped.get(value);
    if (existing) {
      return existing;
    }
    const next = newInspectorId();
    mapped.set(value, next);
    return next;
  };
  return events.map((event) => {
    const copy: { type: string; [key: string]: unknown } = { ...event };
    for (const key of REMINT_ID_KEYS) {
      const value = copy[key];
      if (typeof value === "string" && value.length > 0) {
        copy[key] = idFor(value);
      }
    }
    return copy;
  });
}

/**
 * Inspector-only helper. Apply AG-UI events to a live agent through the
 * same runAgent path a real agent uses, so chat and frontend-tool handlers
 * update. Not a documented product API.
 */
export async function ɵinjectInspectorEvents(params: {
  core: CopilotKitCore;
  agent: AbstractAgent;
  events: ReadonlyArray<{ type: string }>;
}): Promise<InspectorInjectResult> {
  const { core, agent, events } = params;
  if (agent.isRunning) {
    throw new Error("The agent is running. Wait for the current run to end.");
  }
  if (events.length === 0) {
    throw new Error("Snippet JSON must be an array of events.");
  }

  const before = new Set(agent.messages.map((message) => message.id));
  const originalRun = agent.run;
  // AG-UI applies events by `type` string. Snippet JSON is that payload.
  // Mint new message, tool-call, and run ids so a second Run is a new
  // turn. Replaying the saved ids is a no-op: the agent already has them.
  const runEvents = remintInspectorEventIds(events) as BaseEvent[];
  agent.run = (_input: RunAgentInput) => from(runEvents);

  try {
    await core.runAgent({ agent });
  } finally {
    agent.run = originalRun;
  }

  return {
    messageIds: agent.messages
      .filter((message) => !before.has(message.id))
      .map((message) => message.id),
  };
}

/**
 * Remove messages created by the last Inspector inject. Does not undo
 * frontend-tool handler side effects.
 */
export function ɵresetInspectorInject(params: {
  agent: AbstractAgent;
  messageIds: readonly string[];
}): void {
  const drop = new Set(params.messageIds);
  if (drop.size === 0) {
    return;
  }
  const next: Message[] = params.agent.messages.filter(
    (message) => !drop.has(message.id),
  );
  params.agent.setMessages(next);
}

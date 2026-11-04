"use client";

import { useEffect } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import { DEFAULT_THREAD_TITLE, titleFromText } from "@/lib/threads";

const AGENT_ID = "oracle_concierge";

type MinimalMessage = { role?: string; content?: unknown };

/** Text of the first user message in a transcript (handles string or parts). */
function firstUserText(messages: MinimalMessage[]): string {
  const firstUser = messages.find((m) => m?.role === "user");
  const raw = firstUser?.content;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((p) =>
        typeof p === "string" ? p : ((p as { text?: string })?.text ?? ""),
      )
      .join(" ");
  }
  return "";
}

/**
 * Names a thread after its first user message. Mounted (render-null) inside the
 * CopilotKit provider so it can read the active thread's transcript via useAgent.
 *
 * It titles ONLY when the shared agent is actually on the active thread
 * (`agent.threadId === activeThreadId`) and that thread still carries the default
 * title. This is the fix for "a new thread reuses the prior thread's name": the
 * previous implementation ran a useEffect keyed on `activeThreadId`, so on a thread
 * switch it read the shared, agentId-scoped `agent.messages` *before* CopilotChat's
 * connect cleared them — naming the fresh thread after the prior conversation.
 *
 * Instead we drive titling off the agent's own message/run events. Those fire on
 * `addMessage` (the user's submit, by which point `agent.threadId` is the active
 * thread) and on the switch-time `setMessages([])` (empty transcript → no title) —
 * never with another thread's transcript while `threadId` already points here.
 */
export function ThreadTitler({
  activeThreadId,
  activeTitle,
  onTitle,
}: {
  activeThreadId: string;
  activeTitle: string;
  onTitle: (id: string, title: string) => void;
}) {
  const { agent } = useAgent({ agentId: AGENT_ID });

  useEffect(() => {
    if (!agent) return;
    const tryTitle = () => {
      if (!activeThreadId || activeTitle !== DEFAULT_THREAD_TITLE) return;
      // Only title the thread the agent has actually switched to — guards against
      // reading the previous thread's still-loaded transcript during a switch.
      if (agent.threadId !== activeThreadId) return;
      const title = titleFromText(
        firstUserText((agent.messages ?? []) as MinimalMessage[]),
      );
      if (title) onTitle(activeThreadId, title);
    };
    const sub = agent.subscribe({
      onMessagesChanged: tryTitle,
      onRunStartedEvent: tryTitle,
    });
    return () => sub.unsubscribe();
  }, [agent, activeThreadId, activeTitle, onTitle]);

  return null;
}

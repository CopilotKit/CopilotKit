"use client";

/**
 * Reusable bridge for `CopilotKitMiddleware(interrupt_frontend_tools=True)`.
 *
 * The agent pauses each frontend tool call on its own interrupt
 * (`reason: "tool_call"`, `toolCallId`). The client still runs every tool through
 * its normal lifecycle (`useFrontendTool` / `useHumanInTheLoop`) and records the
 * result; this bridge forwards each recorded result to the interrupt for that
 * call. `useInterrupt` sends one resume once every open interrupt has an answer.
 *
 * Usage:
 *   1. Server: `CopilotKitMiddleware(interrupt_frontend_tools=True)` and
 *      `LangGraphAGUIAgent(..., emit_interrupt_outcome=True)`.
 *   2. Client: call `useFrontendToolInterrupts()` once, and register every tool
 *      the agent may call with `followUp: false` (the resume continues the run,
 *      not a follow-up run).
 *
 * Nothing here knows about specific tools.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useAgent,
  useCopilotKit,
  useInterrupt,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";
import type {
  Interrupt,
  InterruptEvent,
  InterruptRenderProps,
} from "@copilotkit/react-core/v2";

// Core records a tool result with `agent.messages.splice(...)`, which fires no
// messages-changed notification, so a result recorded after the interrupt
// arrives (any HITL answer) would never be seen. Re-check after each tool ends.
// Visit /?naive to run without the re-check and watch the HITL case hang.
const RECHECK_ON_TOOL_END =
  typeof window === "undefined" ||
  !new URLSearchParams(window.location.search).has("naive");

function ForwardToolResults({
  agentId,
  interrupts,
  resolve,
}: { agentId: string } & Pick<InterruptRenderProps, "interrupts" | "resolve">) {
  const { agent } = useAgent({
    agentId,
    updates: [UseAgentUpdate.OnMessagesChanged],
  });
  const { copilotkit } = useCopilotKit();
  // A ref, not state: a state guard still reads its pre-commit value on Strict
  // Mode's second pass and answers twice.
  const forwarded = useRef(new Set<string>());
  const [toolEnds, setToolEnds] = useState(0);

  useEffect(() => {
    if (!RECHECK_ON_TOOL_END) return;
    // onToolExecutionEnd fires just before the splice, so re-check a tick later.
    const sub = copilotkit.subscribe({
      onToolExecutionEnd: () =>
        void setTimeout(() => setToolEnds((n) => n + 1)),
    });
    return () => sub.unsubscribe();
  }, [copilotkit]);

  useEffect(() => {
    for (const interrupt of interrupts) {
      if (forwarded.current.has(interrupt.id)) continue;
      const result = agent.messages.find(
        (m) => m.role === "tool" && m.toolCallId === interrupt.toolCallId,
      );
      if (!result) continue; // the tool, or the user, is still working
      forwarded.current.add(interrupt.id);
      void resolve(result.content, interrupt.id);
    }
  }, [agent.messages, interrupts, resolve, toolEnds]);

  return <></>;
}

export function useFrontendToolInterrupts(agentId = "default") {
  // Keep `enabled` and `render` stable: new identities rebuild the element.
  const enabled = useCallback((event: InterruptEvent<unknown>) => {
    const interrupt = event.value as Interrupt | undefined;
    return interrupt?.reason === "tool_call" && Boolean(interrupt.toolCallId);
  }, []);

  const render = useCallback(
    ({ interrupts, resolve }: InterruptRenderProps<unknown, unknown>) => (
      <ForwardToolResults
        agentId={agentId}
        interrupts={interrupts}
        resolve={resolve}
      />
    ),
    [agentId],
  );

  useInterrupt({ agentId, enabled, render });
}

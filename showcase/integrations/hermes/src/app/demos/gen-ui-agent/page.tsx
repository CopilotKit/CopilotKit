"use client";

import React from "react";
import {
  CopilotChat,
  CopilotKit,
  useAgent,
  UseAgentUpdate,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import type { Step } from "./InlineAgentStateCard";
import { MessageListWithState } from "./message-list-with-state";
import { useSuggestions } from "./suggestions";

/**
 * Agentic Generative UI — In-Chat State Rendering
 *
 * The agent defines its own state schema (`steps: list[Step]`) and calls a
 * custom `set_steps` tool to mutate that state. Every `set_steps` call
 * streams the updated `steps` to the client.
 *
 * On the client we subscribe to that live state via `useAgent` (v2) and
 * render a single `InlineAgentStateCard` inside the chat transcript via
 * `messageView.children`. The card re-renders in place as state arrives —
 * no per-message claims, no duplicate cards.
 *
 * Hermes wiring: langgraph-python defines `set_steps` as a backend tool
 * that mutates state via a `Command` update. Hermes has no first-class
 * shared-state store, so its AG-UI adapter provides one per run: the
 * frontend DECLARES `set_steps` -> stateKey `steps` via
 * `forwarded_props["stateWriterTools"]` (the v2 `<CopilotKit properties>`
 * prop is forwarded verbatim into `RunAgentInput.forwarded_props`). The
 * adapter registers a server-side handler that merges each call into
 * run-scoped state and emits a `StateSnapshotEvent` after it, which
 * `useAgent` renders. No server-side route injection needed.
 */

// set_steps({steps}) -> stateKey `steps` (replace, last-write-wins). Each
// call carries the FULL step list; the adapter emits one StateSnapshotEvent
// per call so a multi-call chain animates pending -> in_progress -> completed.
const STATE_WRITER_TOOLS = [
  {
    name: "set_steps",
    stateKey: "steps",
    arg: "steps",
    mode: "replace",
    description:
      "Set the current plan steps and their statuses in shared UI state. " +
      "Pass the FULL updated list of steps as `steps`.",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          description: "The full ordered list of plan steps.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
              },
            },
            required: ["id", "title", "status"],
          },
        },
      },
      required: ["steps"],
    },
  },
];

export default function GenUiAgentDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="gen-ui-agent"
      properties={{ stateWriterTools: STATE_WRITER_TOOLS }}
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

type AgentState = {
  steps?: Step[];
};

function Chat() {
  const { agent } = useAgent({
    agentId: "gen-ui-agent",
    updates: [UseAgentUpdate.OnStateChanged],
  });

  useSuggestions();

  // `set_steps` is an internal state-writer tool (declared to the hermes
  // adapter via forwarded_props). The steps' authoritative surface is the
  // inline InlineAgentStateCard (rendered from the emitted state snapshots).
  // In the transcript we render a compact one-line progress confirmation
  // instead of the default raw tool-call chip. (The hermes adapter derives
  // tool-call events from the returned messages after the run, so the
  // set_steps bubbles trail the assistant's text; keeping them non-empty
  // lets the transcript settle while the live card shows the real steps.)
  useRenderTool(
    {
      name: "set_steps",
      parameters: z.object({
        steps: z
          .array(
            z.object({
              id: z.string().optional(),
              title: z.string().optional(),
              status: z.string().optional(),
            }),
          )
          .optional(),
      }),
      render: ({ args }) => {
        const steps = Array.isArray(args?.steps) ? args.steps : [];
        if (steps.length === 0) return <></>;
        const done = steps.filter((s) => s?.status === "completed").length;
        return (
          <div
            data-testid="set-steps-confirmation"
            className="my-1 text-[11px] text-[#838389]"
          >
            Updated plan — {done}/{steps.length} steps complete
          </div>
        );
      },
    },
    [],
  );

  const steps = (agent.state as AgentState | undefined)?.steps ?? [];
  const status = agent.isRunning ? "inProgress" : "complete";

  return (
    <CopilotChat
      agentId="gen-ui-agent"
      className="h-full rounded-2xl"
      messageView={{
        children: ({ messageElements, interruptElement }) => (
          <MessageListWithState
            messageElements={messageElements}
            interruptElement={interruptElement}
            steps={steps}
            status={status}
          />
        ),
      }}
    />
  );
}

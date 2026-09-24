"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  CopilotChat,
  useAgent,
  useCopilotKit,
  useFrontendTool,
  useHumanInTheLoop,
  useInterrupt,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";
import type {
  Interrupt,
  InterruptEvent,
  InterruptRenderProps,
} from "@copilotkit/react-core/v2";

// --- The bridge: frontend-tools.mdx version + one fix (see README) ------------

// The docs version only re-checks on OnMessagesChanged, but core records a
// tool result with `agent.messages.splice(...)`, which fires no notification.
// So a result recorded AFTER the interrupt arrives (any HITL answer) is never
// forwarded and the run hangs. Visit /?docs to run the docs version verbatim.
const RECHECK_ON_TOOL_END =
  typeof window === "undefined" ||
  !new URLSearchParams(window.location.search).has("docs");

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
      if (!result) continue;
      forwarded.current.add(interrupt.id);
      console.log(
        "[bridge] resolve",
        interrupt.id,
        interrupt.toolCallId,
        result.content,
      );
      void resolve(result.content, interrupt.id);
    }
  }, [agent.messages, interrupts, resolve, toolEnds]);

  return <></>;
}

function useFrontendToolInterrupts(agentId = "default") {
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

// --- Test tools --------------------------------------------------------------

function BarChart({ title, values }: { title?: string; values?: number[] }) {
  const max = Math.max(1, ...(values ?? []));
  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 8,
        padding: 12,
        margin: "8px 0",
      }}
    >
      <strong>{title ?? "Graph"}</strong>
      <div
        style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }}
      >
        {(values ?? []).map((v, i) => (
          <div
            key={i}
            title={String(v)}
            style={{
              flex: 1,
              height: `${(v / max) * 100}%`,
              background: "#6366f1",
            }}
          />
        ))}
      </div>
    </div>
  );
}

export default function Page() {
  const [graphRuns, setGraphRuns] = useState(0);

  useFrontendToolInterrupts();

  // Ordinary frontend tool: its handler must run exactly once per call.
  useFrontendTool({
    name: "show_graph",
    description: "Show a bar chart of the given numbers to the user.",
    parameters: z.object({ title: z.string(), values: z.array(z.number()) }),
    followUp: false,
    handler: async ({ values }) => {
      setGraphRuns((n) => n + 1);
      return { shown: true, points: values.length };
    },
    render: ({ args }) => <BarChart title={args.title} values={args.values} />,
  });

  // HITL frontend tool: the result is whatever the user clicks.
  useHumanInTheLoop({
    name: "confirm_action",
    description: "Ask the user to approve or reject an action.",
    parameters: z.object({ action: z.string() }),
    followUp: false,
    render: ({ args, status, respond, result }) => (
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: 12,
          margin: "8px 0",
        }}
      >
        <div>
          Approve: <b>{args.action}</b>?
        </div>
        {respond ? (
          <>
            <button onClick={() => respond({ approved: true })}>Approve</button>{" "}
            <button onClick={() => respond({ approved: false })}>Reject</button>
          </>
        ) : (
          <small>
            {status} {result ?? ""}
          </small>
        )}
      </div>
    ),
  });

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 8, borderBottom: "1px solid #eee", fontSize: 13 }}>
        show_graph handler runs: <b>{graphRuns}</b> · try: “what time is it,
        chart 3 5 2 8, and ask me to confirm deleting the file — all in one
        turn”
      </div>
      <CopilotChat agentId="default" style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}

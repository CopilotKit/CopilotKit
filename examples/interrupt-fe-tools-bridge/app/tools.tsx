"use client";

/**
 * App-specific frontend tools. Registered exactly as without interrupts, except
 * for `followUp: false` — the bridge in `frontend-tool-interrupts.tsx` delivers
 * the results.
 */

import { z } from "zod";
import { useFrontendTool, useHumanInTheLoop } from "@copilotkit/react-core/v2";

const card = {
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: 12,
  margin: "8px 0",
};

function BarChart({ title, values }: { title?: string; values?: number[] }) {
  const max = Math.max(1, ...(values ?? []));
  return (
    <div style={card}>
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

/** Ordinary frontend tool: its handler must run exactly once per call. */
export function useShowGraphTool(onRun: () => void) {
  useFrontendTool({
    name: "show_graph",
    description: "Show a bar chart of the given numbers to the user.",
    parameters: z.object({ title: z.string(), values: z.array(z.number()) }),
    followUp: false,
    handler: async ({ values }) => {
      onRun();
      return { shown: true, points: values.length };
    },
    render: ({ args }) => <BarChart title={args.title} values={args.values} />,
  });
}

/** HITL frontend tool: the result is whatever the user clicks. */
export function useConfirmActionTool() {
  useHumanInTheLoop({
    name: "confirm_action",
    description: "Ask the user to approve or reject an action.",
    parameters: z.object({ action: z.string() }),
    followUp: false,
    render: ({ args, status, respond, result }) => (
      <div style={card}>
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
}

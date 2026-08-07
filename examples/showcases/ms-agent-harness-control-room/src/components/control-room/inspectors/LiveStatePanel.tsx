"use client";

/**
 * Inspector panel summarizing the agent's current state: mode, observer
 * counts, and the most recent state-validity reading (if the agent has
 * emitted one).
 *
 * This is a native primitive (state is delivered through CopilotKit's coagent
 * channel), so no live-wrapper badge is shown here.
 */

import { useControlRoomAgentState } from "@/hooks/use-control-room-state";

export function LiveStatePanel() {
  const agentState = useControlRoomAgentState();
  const observers = agentState.observers ?? null;

  return (
    <div className="cr-card">
      <h3 className="cr-heading mb-2">Live state</h3>
      <dl className="cr-dl">
        <dt>Mode</dt>
        <dd>{agentState.mode}</dd>
        <dt>Repo files</dt>
        <dd>{observers?.repo_file_count ?? "—"}</dd>
        <dt>Last test</dt>
        <dd>{observers?.latest_test_command ?? "—"}</dd>
        <dt>Last test ok</dt>
        <dd>
          {observers?.latest_test_success == null
            ? "—"
            : observers.latest_test_success
              ? "yes"
              : "no"}
        </dd>
      </dl>
    </div>
  );
}

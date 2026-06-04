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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function LiveStatePanel() {
  const agentState = useControlRoomAgentState();
  const observers = agentState.observers ?? null;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Live state</CardTitle>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}

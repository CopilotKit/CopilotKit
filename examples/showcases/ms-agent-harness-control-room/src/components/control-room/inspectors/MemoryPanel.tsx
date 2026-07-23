"use client";

/**
 * Inspector panel for the agent's memory entries. Native Harness primitive —
 * no wrapper badge.
 */

import { useControlRoomAgentState } from "@/hooks/use-control-room-state";

export function MemoryPanel() {
  const agentState = useControlRoomAgentState();
  const entries = Array.isArray(agentState.memory) ? agentState.memory : [];

  return (
    <div className="cr-card">
      <h3 className="cr-heading mb-2">Memory</h3>
      {entries.length === 0 ? (
        <p
          className="text-[10.5px] uppercase tracking-[0.18em] text-[var(--cr-muted)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          No entries
        </p>
      ) : (
        <table
          className="w-full text-[11px]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          <thead>
            <tr className="text-left text-[var(--cr-muted)]">
              <th className="pb-1 pr-2 font-semibold uppercase tracking-[0.16em]">
                Key
              </th>
              <th className="pb-1 font-semibold uppercase tracking-[0.16em]">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.key} className="border-t border-[var(--cr-rule)]">
                <td className="py-1 pr-2 align-top text-[var(--cr-amber)]">
                  {e.key}
                </td>
                <td className="py-1 align-top text-[var(--cr-fg)]">
                  {e.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

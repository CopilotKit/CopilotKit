/**
 * Optimistic-UI helpers for the canvas write path.
 *
 * These two pure functions are used by `commitLeadEdit` in `app/page.tsx` to
 * apply a Lead patch immediately on the user's screen, then either confirm
 * (via the agent's STATE_SNAPSHOT once the write lands) or revert from a
 * snapshot if the write fails.
 *
 * Keeping them separate from the React tree makes the rollback path
 * trivially testable: you can call `applyPatch(state, leadId, patch)` then
 * `revertPatch(state, leadId, snapshot)` and assert the second result equals
 * the first input — no agent, no CopilotKit, no DOM.
 */

import type { AgentState, Lead } from "./types";

/**
 * Return a new AgentState with `lead.id === leadId` patched. Other leads,
 * filters, segments, header, etc. are passed through unchanged.
 *
 * If no lead matches, returns the same state object reference (no allocation).
 * Callers can detect the no-op by reference equality if they care, but most
 * just dispatch the result and let React's reconciler bail out on its own.
 */
export function applyPatch(
  state: AgentState,
  leadId: string,
  patch: Partial<Lead>,
): AgentState {
  const idx = state.leads.findIndex((l) => l.id === leadId);
  if (idx < 0) return state;
  const next = state.leads.slice();
  next[idx] = { ...state.leads[idx], ...patch };
  return { ...state, leads: next };
}

/**
 * Return a new AgentState with the lead matching `snapshot.id` restored to
 * the snapshot's exact pre-patch shape. Other leads pass through unchanged.
 *
 * Used after a failed write — replays the snapshot the optimistic-UI path
 * captured before mutating local state. If the lead has since been removed
 * (e.g. the agent re-imported and dropped it), the snapshot is appended back
 * to keep the canvas honest about what was edited.
 */
export function revertPatch(state: AgentState, snapshot: Lead): AgentState {
  const idx = state.leads.findIndex((l) => l.id === snapshot.id);
  if (idx < 0) {
    return { ...state, leads: [...state.leads, snapshot] };
  }
  const next = state.leads.slice();
  next[idx] = snapshot;
  return { ...state, leads: next };
}

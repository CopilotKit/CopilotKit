"use client";

/**
 * Pending-approvals placeholder.
 *
 * Approvals from Harness's `ToolApprovalAgent` surface inline in the chat
 * stream — this slot in the left control panel mirrors them for at-a-glance
 * legibility when the workstream pane is scrolled past the latest one.
 */

export function ApprovalQueue() {
  return (
    <div>
      <h3 className="cr-heading mb-2">Pending approvals</h3>
      <div
        className="border border-dashed border-[var(--cr-border-strong)] bg-[var(--cr-surface-3)] p-3 text-[10.5px] uppercase leading-snug tracking-[0.18em] text-[var(--cr-muted)]"
        style={{ fontFamily: "var(--cr-font-mono)" }}
      >
        Approvals appear inline in the workstream when Harness's ToolApproval
        fires
      </div>
    </div>
  );
}

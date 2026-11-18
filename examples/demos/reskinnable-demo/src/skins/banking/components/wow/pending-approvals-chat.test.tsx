import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PolicyType } from "@/skins/banking/data/data";
import type { ExpensePolicy, Transaction } from "@/skins/banking/data/data";
import { RecordingProvider, useRecording } from "@/shell/teach";
import type { RecordedStep } from "@/shell/teach";
import { PendingApprovalsChat } from "./pending-approvals-chat";

/**
 * Survives the migration onto `@/shell/teach` — this is banking's own
 * integration cover, not a test of the recording module. The shell module's
 * `recording.test.tsx` proves the state machine in isolation; nothing there
 * proves that THIS component's `handleApprove` calls into it in the right
 * order, and that ordering has already been wrong once: `logStep` early-returns
 * unless a demonstration is active and `beginRecording` clears the feed, so the
 * inverted order silently drops the narration line with nothing failing.
 */

// A within-tree probe that surfaces the live recorder feed so an assertion can
// read what handleApprove actually captured.
function StepsProbe({
  onSteps,
}: {
  onSteps: (steps: readonly RecordedStep[]) => void;
}) {
  const { steps } = useRecording();
  onSteps(steps);
  return null;
}

describe("PendingApprovalsChat.handleApprove narration", () => {
  it("records the approve step into the recorder feed", async () => {
    // An in-limit charge so the Approve button is enabled and onApprove resolves
    // truthy (the mutation "took effect"), which is what unlocks narration.
    const policy: ExpensePolicy = {
      id: "pol-1",
      type: PolicyType.Technology,
      limit: 1000,
      spent: 0,
    };
    const transaction: Transaction = {
      id: "txn-1",
      title: "Team lunch",
      amount: -25,
      date: "2026-01-01",
      policyId: "pol-1",
      cardId: "card-1",
      status: "pending",
    };

    let latestSteps: readonly RecordedStep[] = [];
    render(
      <RecordingProvider>
        <StepsProbe onSteps={(s) => (latestSteps = s)} />
        <PendingApprovalsChat
          transactions={[transaction]}
          policies={[policy]}
          onApprove={async () => true}
          onDeny={async () => true}
          openPolicyException={async () => ({ ok: true })}
          finalizePolicyException={async () => ({ ok: true })}
        />
      </RecordingProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    // handleApprove is async (awaits onApprove), so the feed updates on a later
    // tick — wait for the recorded step to land.
    await waitFor(() =>
      expect(latestSteps.map((s) => s.label)).toEqual(["Approved the charge"]),
    );
  });
});

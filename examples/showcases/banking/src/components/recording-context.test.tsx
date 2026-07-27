import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExpenseRole } from "@/app/api/v1/data";
import type { ExpensePolicy, Transaction } from "@/app/api/v1/data";
import { PendingApprovalsChat } from "./wow/pending-approvals-chat";
import {
  RecordingProvider,
  useRecording,
  type RecordedStep,
} from "./recording-context";

function Wrapper({ children }: { children: React.ReactNode }) {
  return <RecordingProvider>{children}</RecordingProvider>;
}

describe("RecordingProvider feed ordering", () => {
  // `logStep` early-returns unless a demonstration is active, and `beginRecording`
  // resets the feed with `setSteps([])`. So the approve narration MUST run as
  // beginRecording -> logStep -> endRecording. This is the exact invariant the
  // handleApprove handlers in transactions-list.tsx and
  // wow/pending-approvals-chat.tsx rely on.
  it("captures the approve step when begin precedes logStep", () => {
    const { result } = renderHook(() => useRecording(), { wrapper: Wrapper });

    // Replays the corrected handleApprove ordering.
    act(() => {
      result.current.beginRecording();
      result.current.logStep("Approved the charge");
      result.current.endRecording();
    });

    expect(result.current.steps.map((s) => s.label)).toEqual([
      "Approved the charge",
    ]);
  });

  it("drops the step when logStep runs before beginRecording (the bug)", () => {
    const { result } = renderHook(() => useRecording(), { wrapper: Wrapper });

    // Replays the ORIGINAL (buggy) ordering: logStep first is a no-op because
    // the demonstration is not active yet, and beginRecording then clears the
    // feed. This documents why the inverted order silently dropped the line.
    act(() => {
      result.current.logStep("Approved the charge");
      result.current.beginRecording();
      result.current.endRecording();
    });

    expect(result.current.steps).toEqual([]);
  });
});

// A within-tree probe that surfaces the live recorder feed so an assertion can
// read what handleApprove actually captured.
function StepsProbe({ onSteps }: { onSteps: (steps: RecordedStep[]) => void }) {
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
      type: ExpenseRole.Engineering,
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

    let latestSteps: RecordedStep[] = [];
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

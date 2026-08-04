import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ApprovalsQueueSurface } from "@/skins/keel/components/approvals-queue";
import type {
  ApprovalItem,
  MutationResult,
  Run,
  RunStep,
} from "@/skins/keel/data/types";

afterEach(() => cleanup());

const step: RunStep = {
  id: "s1",
  title: "Approve access grant",
  role: "HR Operations",
  requiresApproval: true,
  approverRole: "Compliance Officer",
  durationMs: 1000,
  status: "awaiting_approval",
};

const run: Run = {
  id: "RUN-1043",
  playbookId: "pb-access",
  title: "Grant PHI access",
  subject: "Priya Raman — Radiology contractor",
  requestedBy: "Alex Chen",
  createdAt: new Date().toISOString(),
  status: "blocked",
  steps: [step],
};

const items: ApprovalItem[] = [{ run, step, actionable: true }];

describe("ApprovalsQueueSurface", () => {
  it("surfaces the reason when a quick-approve fails (stale-gate race)", () => {
    const fail: MutationResult = {
      ok: false,
      reason: "That approval gate already advanced.",
    };
    const approve = vi.fn(() => fail);
    render(<ApprovalsQueueSurface items={items} approve={approve} />);

    // Before the click there is no failure text.
    expect(
      screen.queryByText("That approval gate already advanced."),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    // The MutationResult is consumed and its reason surfaced beneath the row —
    // NOT discarded (the regression this guards against).
    expect(approve).toHaveBeenCalledWith("RUN-1043", "s1");
    expect(
      screen.getByText("That approval gate already advanced."),
    ).toBeTruthy();
  });

  it("shows no error when the approval succeeds", () => {
    const approve = vi.fn(() => ({ ok: true }) as MutationResult);
    render(<ApprovalsQueueSurface items={items} approve={approve} />);

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    expect(approve).toHaveBeenCalledWith("RUN-1043", "s1");
    expect(screen.queryByText(/could not/i)).toBeNull();
  });
});

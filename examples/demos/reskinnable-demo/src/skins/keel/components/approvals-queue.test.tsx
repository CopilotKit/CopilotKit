import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ApprovalsQueueSurface } from "@/skins/keel/components/approvals-queue";
import type { ApprovalItem, Run, RunStep } from "@/skins/keel/data/types";
import type { DeskMutationResult } from "@/skins/keel/desk-data";

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
  it("surfaces the reason when a quick-approve fails (stale-gate race)", async () => {
    const fail: DeskMutationResult = {
      ok: false,
      reason: "That approval gate already advanced.",
    };
    const approve = vi.fn(() => Promise.resolve(fail));
    render(<ApprovalsQueueSurface items={items} approve={approve} />);

    // Before the click there is no failure text.
    expect(
      screen.queryByText("That approval gate already advanced."),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    // The result is consumed and its reason surfaced beneath the row — NOT
    // discarded (the regression this guards against).
    expect(approve).toHaveBeenCalledWith("RUN-1043", "s1");
    expect(
      await screen.findByText("That approval gate already advanced."),
    ).toBeTruthy();
  });

  it("shows no error when the approval succeeds", async () => {
    const approve = vi.fn(() => Promise.resolve({ ok: true }));
    render(<ApprovalsQueueSurface items={items} approve={approve} />);

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await vi.waitFor(() =>
      expect(approve).toHaveBeenCalledWith("RUN-1043", "s1"),
    );
    expect(screen.queryByText(/could not/i)).toBeNull();
  });

  /**
   * The third outcome, which only exists now that the write crosses the network:
   * the approval LANDED and the ledger re-read did not, so the queue on screen is
   * still the pre-approval one. Reporting that as a plain success is
   * indistinguishable from a slow network, so the row must say so.
   */
  it("surfaces a stale success — the write landed, this view did not move", async () => {
    const approve = vi.fn(() =>
      Promise.resolve<DeskMutationResult>({
        ok: true,
        stale: true,
        reason: "That was recorded, but this view could not be refreshed.",
      }),
    );
    render(<ApprovalsQueueSurface items={items} approve={approve} />);

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    expect(
      await screen.findByText(
        "That was recorded, but this view could not be refreshed.",
      ),
    ).toBeTruthy();
  });
});
